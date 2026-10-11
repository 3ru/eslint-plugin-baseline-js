import { promises as fs } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import apiDescriptors from "../src/baseline/data/descriptors.api";

describe("Web API DOM declaration corpus", () => {
  it("detects every declared instance member on direct, nullable and generic receivers", async () => {
    const root = await fs.mkdtemp(join(os.tmpdir(), "baseline-js-dom-corpus-"));
    try {
      const samplePath = join(root, "sample.ts");
      const tsconfigPath = join(root, "tsconfig.json");
      const configPath = join(root, "eslint.config.mjs");
      const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2023,
        lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
        noEmit: true,
        strict: true,
        skipLibCheck: true,
      };
      await fs.writeFile(samplePath, "export {};\n");
      const declarationProgram = ts.createProgram([samplePath], compilerOptions);
      const checker = declarationProgram.getTypeChecker();
      const dom = declarationProgram
        .getSourceFiles()
        .find((source) => source.fileName.endsWith("/lib.dom.d.ts"));
      expect(dom).toBeDefined();
      if (!dom) return;
      const interfaces = new Map<string, { type: ts.Type; requiredTypeArguments: number }>();
      for (const statement of dom.statements) {
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
        `Web API DOM corpus: ${descriptors.length} resolvable instance descriptors; ` +
          `${missingInterface} owners and ${missingMember} members unavailable in lib.dom.`,
      );
      expect(descriptors.length).toBeGreaterThan(0);

      const rows = ["direct", "nullable", "generic"].flatMap((form) =>
        descriptors.map((descriptor) => ({ form, descriptor })),
      );
      const source = rows.map(({ form, descriptor }, index) => {
        const owner = interfaces.get(descriptor.iface);
        const typeArguments = owner?.requiredTypeArguments
          ? `<${Array(owner.requiredTypeArguments).fill("any").join(", ")}>`
          : "";
        const typeName = `${descriptor.iface}${typeArguments}`;
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
            lib: ["ES2023", "DOM"],
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
        .map(({ form, descriptor }, index) => ({ form, descriptor, line: index + 1 }))
        .filter(({ descriptor, line }) => !featuresByLine.get(line)?.has(descriptor.featureId));
      expect(missing.slice(0, 20), `${missing.length} missing Web API corpus diagnostics`).toEqual(
        [],
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
