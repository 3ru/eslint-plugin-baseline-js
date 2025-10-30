#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function sectionCoverage(md, title) {
  const header = `## ${title}`;
  const idx = md.indexOf(header);
  if (idx < 0) return null;
  const segment = md.slice(idx, Math.min(md.length, idx + 500));
  const m = segment.match(/- coverage:\s*`?([0-9.]+)%`?/);
  return m ? Number(m[1]) : null;
}

function main() {
  const args = parseArgs(process.argv);

  const mention = args.mention || process.env.MENTION || "@";
  const thSyntax = Number(args["threshold-syntax"] || process.env.THRESHOLD_SYNTAX || "100");
  const thApi = Number(args["threshold-api"] || process.env.THRESHOLD_API || "98");
  const thJsbi = Number(args["threshold-jsbi"] || process.env.THRESHOLD_JSBI || "99");
  const mdPath = resolve(process.cwd(), args["coverage-file"] || "docs/coverage.md");

  const src = readFileSync(mdPath, "utf8");

  const covSyntax = sectionCoverage(src, "JavaScript Language (syntax)");
  const covApi = sectionCoverage(src, "Web APIs (api.*)");
  const covJsbi = sectionCoverage(src, "JavaScript Builtins (javascript.*)");

  const below = [];
  if (covSyntax !== null && covSyntax < thSyntax)
    below.push({ key: "JavaScript (syntax)", val: covSyntax, th: thSyntax });
  if (covApi !== null && covApi < thApi)
    below.push({ key: "Web APIs (api.*)", val: covApi, th: thApi });
  if (covJsbi !== null && covJsbi < thJsbi)
    below.push({ key: "JS Builtins (javascript.*)", val: covJsbi, th: thJsbi });

  const shouldComment = below.length > 0;

  const marker = "<!-- baseline-coverage-gate -->";
  const body = !shouldComment
    ? `${marker}\nCoverage check passed.\n\n- JavaScript (syntax): ${covSyntax}%\n- Web APIs (api.*): ${covApi}%\n- JS Builtins (javascript.*): ${covJsbi}%\n\nThresholds: syntax>=${thSyntax} api>=${thApi} jsbi>=${thJsbi}`
    : `${marker}\n${mention} Coverage dropped below thresholds.\n\n- JavaScript (syntax): ${covSyntax}% (>= ${thSyntax} required)\n- Web APIs (api.*): ${covApi}% (>= ${thApi} required)\n- JS Builtins (javascript.*): ${covJsbi}% (>= ${thJsbi} required)`;

  const out = {
    covSyntax,
    covApi,
    covJsbi,
    below,
    shouldComment,
    commentBody: body,
  };

  const outPath = args.out ? resolve(process.cwd(), args.out) : null;
  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
    console.log(`wrote ${outPath}`);
  } else {
    console.log(JSON.stringify(out, null, 2));
  }

  const ghOutPath = args["github-output"] || process.env.GITHUB_OUTPUT;
  if (ghOutPath) {
    const toLine = (key, value) => `${key}=${value == null ? "" : String(value)}`;
    const commentBody = String(out.commentBody ?? "");
    const payload = [
      toLine("covSyntax", out.covSyntax),
      toLine("covApi", out.covApi),
      toLine("covJsbi", out.covJsbi),
      `shouldComment=${out.shouldComment ? "true" : "false"}`,
      "commentBody<<__COVERAGE_COMMENT__",
      commentBody,
      "__COVERAGE_COMMENT__",
    ].join("\n");
    appendFileSync(ghOutPath, `${payload}\n`, "utf8");
  }
}

main();
