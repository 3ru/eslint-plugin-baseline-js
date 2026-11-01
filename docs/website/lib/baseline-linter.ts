import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import type { BaselineTarget, LintDiagnostic } from "@/lib/editor-lint";

type Pending = {
  resolve: (messages: LintDiagnostic[]) => void;
  reject: (error: Error) => void;
};

type WorkerSlot = {
  child: ChildProcessWithoutNullStreams;
  pending: Map<number, Pending>;
  nextId: number;
  stderr: string;
  writes: Promise<void>;
};

const globalSlot = globalThis as typeof globalThis & {
  __baselineLintWorker?: WorkerSlot;
};

function workerScript() {
  return path.join(process.cwd(), "lib", "baseline-lint-worker.mjs");
}

function rejectAll(slot: WorkerSlot, error: Error) {
  for (const pending of slot.pending.values()) pending.reject(error);
  slot.pending.clear();
}

function startWorker(): WorkerSlot {
  const child = spawn(process.execPath, [workerScript()], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const slot: WorkerSlot = {
    child,
    pending: new Map(),
    nextId: 1,
    stderr: "",
    writes: Promise.resolve(),
  };
  const lines = createInterface({ input: child.stdout });

  lines.on("line", (line) => {
    let payload: { id?: number | null; messages?: LintDiagnostic[]; error?: string };
    try {
      payload = JSON.parse(line) as typeof payload;
    } catch {
      return;
    }
    if (payload.id == null) return;
    const pending = slot.pending.get(payload.id);
    if (!pending) return;
    slot.pending.delete(payload.id);
    if (payload.error) pending.reject(new Error(payload.error));
    else pending.resolve(payload.messages ?? []);
  });

  child.stderr.on("data", (chunk: Buffer) => {
    slot.stderr = `${slot.stderr}${chunk.toString()}`.slice(-4000);
  });

  child.on("exit", () => {
    if (globalSlot.__baselineLintWorker === slot) globalSlot.__baselineLintWorker = undefined;
    const missing = slot.stderr.includes("Missing plugin build");
    rejectAll(
      slot,
      new Error(missing ? "The plugin build could not be loaded." : "Linting failed."),
    );
  });

  return slot;
}

function ensureWorker() {
  const current = globalSlot.__baselineLintWorker;
  if (current && current.child.exitCode === null && !current.child.killed) {
    current.writes ??= Promise.resolve();
    return current;
  }
  const slot = startWorker();
  globalSlot.__baselineLintWorker = slot;
  return slot;
}

export function lintWithPlugin(code: string, available: BaselineTarget) {
  const slot = ensureWorker();
  const id = slot.nextId;
  slot.nextId += 1;

  return new Promise<LintDiagnostic[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      slot.pending.delete(id);
      reject(new Error("Linting failed."));
    }, 15000);
    slot.pending.set(id, {
      resolve: (messages) => {
        clearTimeout(timer);
        resolve(messages);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    const enqueue = () =>
      new Promise<void>((done, fail) => {
        slot.child.stdin.write(`${JSON.stringify({ id, code, available })}\n`, (error) => {
          if (!error) {
            done();
            return;
          }
          if (slot.pending.has(id)) {
            slot.pending.delete(id);
            clearTimeout(timer);
            reject(error);
          }
          fail(error);
        });
      });
    slot.writes = slot.writes.then(enqueue, enqueue).then(
      () => undefined,
      () => undefined,
    );
  });
}
