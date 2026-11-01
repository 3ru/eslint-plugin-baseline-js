"use client";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
  WidgetType,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef, useState } from "react";
import {
  type BaselineTarget,
  DEFAULT_BASELINE_YEAR,
  isBaselineYear,
  type LintDiagnostic,
  MAX_BASELINE_YEAR,
  MAX_SOURCE_BYTES,
  MIN_BASELINE_YEAR,
} from "@/lib/editor-lint";

const STARTER = `function read(input) {
  const date = new Date();
  const year = date.getYear();
  const id = 1n;
  const label = input ?? "guest";
  const parsed = URL.parse("https://example.com");
  const settled = Promise.withResolvers();
  return { year, id, label, parsed, settled };
}`;

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--lp-syn-keyword)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--lp-syn-string)" },
  { tag: tags.number, color: "var(--lp-syn-number)" },
  { tag: tags.comment, color: "var(--lp-muted)" },
  { tag: [tags.operator, tags.punctuation], color: "var(--lp-fg)" },
  {
    tag: [tags.variableName, tags.propertyName, tags.function(tags.variableName)],
    color: "var(--lp-fg)",
  },
]);

const setDiagnostics = StateEffect.define<LintDiagnostic[]>();

class DiagnosticWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: DiagnosticWidget) {
    return other.text === this.text;
  }

  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-baseline-lens";
    el.textContent = this.text;
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function offsetAt(doc: EditorState["doc"], lineNo: number, column: number) {
  const line = doc.line(clamp(lineNo, 1, doc.lines));
  return clamp(line.from + Math.max(0, column - 1), line.from, line.to);
}

function buildDecorations(doc: EditorState["doc"], messages: readonly LintDiagnostic[]) {
  const ranges: Range<Decoration>[] = [];
  const markedLines = new Set<number>();
  const sorted = [...messages].sort((a, b) => a.line - b.line || a.column - b.column);

  sorted.forEach((message, index) => {
    if (message.line < 1) return;
    const lineNo = clamp(message.line, 1, doc.lines);
    const line = doc.line(lineNo);
    if (!markedLines.has(lineNo)) {
      markedLines.add(lineNo);
      ranges.push(Decoration.line({ class: "cm-baseline-line" }).range(line.from));
    }

    const from = offsetAt(doc, message.line, message.column);
    let to = from;
    if (message.endLine != null && message.endColumn != null) {
      to = offsetAt(doc, message.endLine, message.endColumn);
    }
    if (to <= from) to = Math.min(line.to, from + 1);
    if (to > from) {
      ranges.push(Decoration.mark({ class: "cm-baseline-squiggle" }).range(from, to));
    }

    ranges.push(
      Decoration.widget({
        widget: new DiagnosticWidget(message.message),
        block: true,
        side: index + 1,
      }).range(line.to),
    );
  });

  return Decoration.set(ranges, true);
}

const diagnosticField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setDiagnostics)) {
        next = buildDecorations(transaction.state.doc, effect.value);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

type Policy = "widely" | "newly" | "year";

function targetLabel(policy: Policy, yearText: string) {
  if (policy === "year") return yearText || "year";
  return policy;
}

export function BaselineEditor() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [policy, setPolicy] = useState<Policy>("widely");
  const [yearText, setYearText] = useState(String(DEFAULT_BASELINE_YEAR));
  const [code, setCode] = useState(STARTER);
  const [note, setNote] = useState("Checking with baseline-js/use-baseline…");

  const year = Number(yearText);
  const yearValid = isBaselineYear(year);
  const available: BaselineTarget | null = policy === "year" ? (yearValid ? year : null) : policy;

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: STARTER,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          bracketMatching(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          javascript(),
          syntaxHighlighting(highlight),
          diagnosticField,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": "JavaScript source",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setCode(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (available === null) {
      view.dispatch({ effects: setDiagnostics.of([]) });
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const source = view.state.doc.toString();
      if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) {
        setNote("Source is longer than 8 KB, so this editor did not lint it.");
        view.dispatch({ effects: setDiagnostics.of([]) });
        return;
      }

      void fetch("/api/lint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: source, available }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = (await response.json()) as {
            messages?: LintDiagnostic[];
            error?: string;
          };
          if (!response.ok) {
            throw new Error(payload.error || "Linting failed.");
          }
          return payload.messages ?? [];
        })
        .then((next) => {
          if (controller.signal.aborted || viewRef.current !== view) return;
          const count = next.length;
          const problems = count === 1 ? "1 problem" : `${count} problems`;
          setNote(
            count === 0
              ? `baseline-js/use-baseline · ${targetLabel(policy, yearText)} · no problems`
              : `baseline-js/use-baseline · ${targetLabel(policy, yearText)} · ${problems}`,
          );
          view.dispatch({ effects: setDiagnostics.of(next) });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || viewRef.current !== view) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          setNote("The linter did not respond.");
        });
    }, 150);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [available, code, policy, yearText]);

  return (
    <div className="baseline-editor">
      <div className="baseline-editor-bar">
        <span className="baseline-editor-name">example.js</span>
        <div className="baseline-editor-controls">
          <div role="radiogroup" aria-label="Baseline target">
            {(
              [
                ["widely", "Widely"],
                ["newly", "Newly"],
                ["year", "Year"],
              ] as const
            ).map(([id, label]) => {
              const selected = policy === id;
              return (
                <label key={id} data-selected={selected ? "true" : "false"}>
                  <input
                    type="radio"
                    name="baseline-target"
                    className="sr-only"
                    value={id}
                    checked={selected}
                    onChange={() => setPolicy(id)}
                  />
                  {label}
                </label>
              );
            })}
          </div>
          {policy === "year" ? (
            <input
              type="number"
              inputMode="numeric"
              min={MIN_BASELINE_YEAR}
              max={MAX_BASELINE_YEAR}
              step={1}
              value={yearText}
              aria-label="Baseline year"
              spellCheck={false}
              onChange={(event) => setYearText(event.target.value)}
            />
          ) : null}
        </div>
      </div>
      <div ref={hostRef} />
      <p className="baseline-editor-status" aria-live="polite">
        {available === null
          ? `Enter a year from ${MIN_BASELINE_YEAR} to ${MAX_BASELINE_YEAR}.`
          : note}
      </p>
    </div>
  );
}
