import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { it, expect } from "vitest";

// Execute the page's real request handlers without rendering React or replacing their logic.
const source = readFileSync(new URL("../../web/src/app/governance/reviews/page.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers: string[] = [];
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ["loadQueue", "submitDecision"].includes(node.name?.text ?? "")) handlers.push(node.getText(parsed));
  ts.forEachChild(node, visit);
}
visit(parsed);
const script = ts.transpileModule(`${handlers.join("\n")}\nglobalThis.submit = submitDecision;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

for (const decision of ["ACCEPT", "REQUEST_MORE_EVIDENCE"]) it(`refreshes authoritative vendor queue after ${decision}`, async () => {
  const finding = { id: "disposable-finding", assessment: { id: "disposable-assessment" } };
  let rows: unknown[] = [finding], getCount = 0;
  const context = {
    process: { env: { NEXT_PUBLIC_API_URL: "http://test-api" } },
    decisions: { [finding.id]: decision }, rationales: { [finding.id]: "Human rationale" },
    setSubmitting: () => {}, setLoading: () => {}, setError: () => {}, setForbidden: () => {}, alert: () => {},
    setFindings: (value: unknown[] | ((previous: unknown[]) => unknown[])) => { rows = typeof value === "function" ? value(rows) : value; },
    fetch: async (_url: string, options?: { method: string }) => {
      if (options?.method === "POST") return { ok: true };
      getCount++;
      return { ok: true, json: async () => ({ findings: decision === "REQUEST_MORE_EVIDENCE" ? [finding] : [] }) };
    },
    submit: undefined as unknown as (row: typeof finding) => Promise<void>,
  };
  runInNewContext(script, context);
  await context.submit(finding);
  expect(getCount).toBe(1);
  expect(rows).toEqual(decision === "REQUEST_MORE_EVIDENCE" ? [finding] : []);
});
it("keeps a rejected or failed submission visible instead of hiding undecided work", async () => {
  const finding = { id: "disposable-finding", assessment: { id: "disposable-assessment" } };
  let rows: unknown[] = [finding], reads = 0;
  const context = {
    process: { env: { NEXT_PUBLIC_API_URL: "http://test-api" } },
    decisions: { [finding.id]: "ACCEPT" }, rationales: { [finding.id]: "Human rationale" },
    setSubmitting: () => {}, setLoading: () => {}, setError: () => {}, setForbidden: () => {}, alert: () => {},
    setFindings: (value: unknown[]) => { rows = value; },
    fetch: async (_url: string, options?: { method: string }) => {
      if (!options) reads++;
      return { ok: false, json: async () => ({ error: "Decision not committed" }) };
    },
    submit: undefined as unknown as (row: typeof finding) => Promise<void>,
  };
  runInNewContext(script, context);
  await context.submit(finding);
  expect(reads).toBe(0);
  expect(rows).toEqual([finding]);
});
