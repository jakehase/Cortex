#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { executeProviderWorkflow } from "./run-provider-workflow.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const valueAfter = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
const casesPath = path.resolve(valueAfter("cases", path.join(root, "kernel", "workflows", "provider-dogfood-cases.json")));
const artifactRoot = path.resolve(valueAfter("artifact-root", path.join(root, "artifacts", "provider-workflow-dogfood", `batch-${stamp}`)));
const ledgerPath = path.resolve(valueAfter("ledger", path.join(artifactRoot, "ledger.jsonl")));
const policyPath = path.resolve(valueAfter("provider-policy", path.join(root, "kernel", "policy", "provider-read-compute.json")));
const cases = JSON.parse(fs.readFileSync(casesPath, "utf8")).cases ?? [];
fs.mkdirSync(artifactRoot, { recursive: true });
const results = [];
for (const [index, item] of cases.entries()) {
  const runId = `${String(index + 1).padStart(3, "0")}-${item.workflow}`;
  const runRoot = path.join(artifactRoot, "runs", runId);
  const result = executeProviderWorkflow({
    workflowId: item.workflow,
    query: item.query,
    runId,
    artifactRoot: runRoot,
    policyPath,
    ledgerPath,
  });
  results.push({ runId, workflowId: result.workflowId, status: result.status, claimStatus: result.claimStatus, durationMs: result.durationMs, resultPath: result.resultPath });
  process.stderr.write(`[${index + 1}/${cases.length}] ${runId}: ${result.status}\n`);
}
const summary = {
  schemaVersion: "aios.provider-workflow-batch.v1",
  generatedAt: new Date().toISOString(),
  status: results.length === cases.length && results.every((result) => result.status === "green" && result.claimStatus === "allowed") ? "green" : "red",
  caseCount: cases.length,
  successfulRuns: results.filter((result) => result.status === "green" && result.claimStatus === "allowed").length,
  workflowCount: new Set(results.map((result) => result.workflowId)).size,
  artifactRoot,
  ledgerPath,
  results,
};
const summaryPath = path.join(artifactRoot, "batch-summary.json");
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
if (summary.status !== "green") process.exitCode = 1;
