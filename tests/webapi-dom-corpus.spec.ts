import { promises as fs } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import apiDescriptors from "../src/baseline/data/descriptors.api";

describe.each([
  { name: "DOM", lib: "DOM", declaration: "lib.dom.d.ts" },
  { name: "Web Worker", lib: "WebWorker", declaration: "lib.webworker.d.ts" },
])("Web API $name declaration corpus", ({ name, lib, declaration }) => {
  it("detects declared instance members on direct, nullable, generic and inherited receivers", async () => {
    const root = await fs.mkdtemp(join(os.tmpdir(), "baseline-js-dom-corpus-"));
    try {
      const samplePath = join(root, "sample.ts");
      const tsconfigPath = join(root, "tsconfig.json");
      const configPath = join(root, "eslint.config.mjs");
      const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2023,
        lib: ["lib.es2023.d.ts", declaration],
        noEmit: true,
        strict: true,
        skipLibCheck: true,
      };
      await fs.writeFile(samplePath, "export {};\n");
      const declarationProgram = ts.createProgram([samplePath], compilerOptions);
      const checker = declarationProgram.getTypeChecker();
      const library = declarationProgram
        .getSourceFiles()
        .find((source) => source.fileName.endsWith(`/${declaration}`));
      expect(library).toBeDefined();
      if (!library) return;
      const interfaces = new Map<string, { type: ts.Type; requiredTypeArguments: number }>();
      for (const statement of library.statements) {
        if (!ts.isInterfaceDeclaration(statement)) continue;
        const symbol = checker.getSymbolAtLocation(statement.name);
        if (!symbol) continue;
        interfaces.set(statement.name.text, {
          type: checker.getDeclaredTypeOfSymbol(symbol),
          requiredTypeArguments: (statement.typeParameters ?? []).filter(
            (parameter) => !parameter.default,
          ).length,
        });
      }
      const instanceDescriptors = apiDescriptors.filter(
        (descriptor) => descriptor.kind === "instanceMember",
      );
      const descriptors = instanceDescriptors.filter((descriptor) => {
        const owner = interfaces.get(descriptor.iface);
        return owner && checker.getPropertyOfType(owner.type, descriptor.prop);
      });
      const missingInterface = instanceDescriptors.filter(
        (descriptor) => !interfaces.has(descriptor.iface),
      ).length;
      const missingMember = instanceDescriptors.length - missingInterface - descriptors.length;
      console.info(
        `Web API ${name} corpus: ${descriptors.length} resolvable instance descriptors; ` +
          `${missingInterface} owners and ${missingMember} members unavailable in ${declaration}.`,
      );
      expect(descriptors.length).toBeGreaterThan(0);

      const rows = ["direct", "nullable", "generic"].flatMap((form) =>
        descriptors.map((descriptor) => ({ form, descriptor, receiver: descriptor.iface })),
      );
      const descriptorsByInterface = new Map<string, typeof descriptors>();
      for (const descriptor of descriptors) {
        const members = descriptorsByInterface.get(descriptor.iface) ?? [];
        members.push(descriptor);
        descriptorsByInterface.set(descriptor.iface, members);
      }
      const inheritedRows: typeof rows = [];
      for (const [receiver, owner] of interfaces) {
        const pending = [{ type: owner.type, depth: 0 }];
        const visited = new Set<ts.Type>();
        for (let index = 0; index < pending.length; index++) {
          const current = pending[index];
          if (!current || visited.has(current.type)) continue;
          visited.add(current.type);
          if (current.depth > 2) {
            const name = current.type.getSymbol()?.getName() ?? "";
            for (const descriptor of descriptorsByInterface.get(name) ?? []) {
              if (checker.getPropertyOfType(owner.type, descriptor.prop)) {
                inheritedRows.push({ form: "inherited", descriptor, receiver });
              }
            }
          }
          for (const base of current.type.getBaseTypes?.() ?? []) {
            pending.push({ type: base, depth: current.depth + 1 });
          }
        }
      }
      console.info(
        `Web API ${name} corpus: ${inheritedRows.length} deeply inherited member cases.`,
      );
      expect(inheritedRows.length).toBeGreaterThan(0);
      rows.push(...inheritedRows);
      const source = rows.map(({ form, descriptor, receiver }, index) => {
        const owner = interfaces.get(receiver);
        const typeArguments = owner?.requiredTypeArguments
          ? `<${Array(owner.requiredTypeArguments).fill("any").join(", ")}>`
          : "";
        const typeName = `${receiver}${typeArguments}`;
        const property = ts.isIdentifierText(descriptor.prop, ts.ScriptTarget.ESNext)
          ? `.${descriptor.prop}`
          : `[${JSON.stringify(descriptor.prop)}]`;
        if (form === "generic") {
          return `function probe${index}<T extends ${typeName}>(value: T) { value${property}; }`;
        }
        if (form === "nullable") {
          const optionalProperty = property.startsWith(".") ? `?${property}` : `?.${property}`;
          return `declare const value${index}: ${typeName} | null; value${index}${optionalProperty};`;
        }
        return `declare const value${index}: ${typeName}; value${index}${property};`;
      });
      await fs.writeFile(samplePath, `${source.join("\n")}\nexport {};\n`);
      const program = ts.createProgram([samplePath], compilerOptions);
      expect(
        ts
          .getPreEmitDiagnostics(program)
          .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
      ).toEqual([]);
      await fs.writeFile(
        tsconfigPath,
        JSON.stringify({
          compilerOptions: {
            target: "ES2023",
            lib: ["ES2023", lib],
            noEmit: true,
            strict: true,
            skipLibCheck: true,
          },
          include: ["sample.ts"],
        }),
      );
      await fs.writeFile(configPath, "export default [{}];\n");
      const parser = (await import("@typescript-eslint/parser")).default;
      const plugin = (await import("../dist/index.mjs")).default;
      const eslint = new ESLint({
        cwd: root,
        overrideConfigFile: configPath,
        overrideConfig: [
          {
            files: ["**/*.ts"],
            languageOptions: {
              parser,
              parserOptions: { project: [tsconfigPath], tsconfigRootDir: root },
            },
            plugins: { "baseline-js": plugin },
            rules: {
              "baseline-js/use-baseline": [
                "error",
                {
                  available: 0,
                  includeWebApis: {
                    preset: "type-aware",
                    only: [...new Set(descriptors.map((descriptor) => descriptor.featureId))],
                  },
                  includeJsBuiltins: false,
                },
              ],
            },
          },
        ],
      });
      const results = await eslint.lintFiles([samplePath]);
      const messages = results.flatMap((result) => result.messages);
      expect(messages.filter((message) => message.fatal)).toEqual([]);
      const featuresByLine = new Map<number, Set<string>>();
      for (const message of messages) {
        if (message.ruleId !== "baseline-js/use-baseline") continue;
        const featureId = message.message.match(/\(([^)]+)\)\.$/)?.[1];
        if (!featureId) continue;
        const features = featuresByLine.get(message.line) ?? new Set<string>();
        features.add(featureId);
        featuresByLine.set(message.line, features);
      }
      const missing = rows
        .map(({ form, descriptor, receiver }, index) => ({
          form,
          descriptor,
          receiver,
          line: index + 1,
        }))
        .filter(({ descriptor, line }) => !featuresByLine.get(line)?.has(descriptor.featureId));
      expect(missing.slice(0, 20), `${missing.length} missing Web API corpus diagnostics`).toEqual(
        [],
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
