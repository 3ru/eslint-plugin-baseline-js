/**
 * Loads dist/index.mjs outside the Next.js bundler and runs ESLint's Linter.
 * Turbopack will not import that built file from a route module.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Linter } from "eslint";

const pluginFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../dist/index.mjs",
);

if (!existsSync(pluginFile)) {
  console.error(`Missing plugin build: ${pluginFile}`);
  process.exit(1);
}

const imported = await import(pathToFileURL(pluginFile).href);
const plugin = imported.default;
const linter = new Linter({ configType: "flat", cwd: path.resolve(pluginFile, "../..") });

function toDiagnostic(message) {
  return {
    line: message.line,
    column: message.column,
    endLine: message.endLine ?? null,
    endColumn: message.endColumn ?? null,
    message: message.message,
    severity: message.severity === 1 ? 1 : 2,
  };
}

function lint(code, available) {
  const messages = linter.verify(
    code,
    {
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      plugins: { "baseline-js": plugin },
      rules: {
        "baseline-js/use-baseline": [
          "error",
          {
            available,
            includeWebApis: { preset: "auto" },
            includeJsBuiltins: { preset: "auto" },
          },
        ],
      },
    },
    "example.js",
  );
  return messages.map(toDiagnostic);
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    process.stdout.write(`${JSON.stringify({ id: null, error: "Invalid request." })}\n`);
    return;
  }

  try {
    const messages = lint(request.code, request.available);
    process.stdout.write(`${JSON.stringify({ id: request.id, messages })}\n`);
  } catch (error) {
    console.error("baseline-js lint failed", error);
    process.stdout.write(`${JSON.stringify({ id: request.id, error: "Linting failed." })}\n`);
  }
});
