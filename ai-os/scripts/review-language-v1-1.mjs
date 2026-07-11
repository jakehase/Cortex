#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateV11Evidence } from "../packages/aios-language/governance/version-freeze.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const valueAfter = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const ledgerPath = path.resolve(valueAfter("ledger", path.join(root, "artifacts", "provider-workflow-dogfood", "ledger.jsonl")));
const policyPath = path.resolve(valueAfter("policy", path.join(root, "kernel", "policy", "language-v1-freeze.json")));
const outputPath = path.resolve(valueAfter("output", path.join(path.dirname(ledgerPath), "language-v1.1-review.json")));
const entries = fs.existsSync(ledgerPath)
  ? fs.readFileSync(ledgerPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  : [];
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const result = { ...evaluateV11Evidence(entries, policy), ledgerPath, policyPath };
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
const markdownPath = outputPath.replace(/\.json$/i, ".md");
const rows = result.candidates.length > 0
  ? result.candidates.map((candidate) => `| ${candidate.code} | ${candidate.occurrences} | ${candidate.distinctRuns} | ${candidate.distinctWorkflows} | ${candidate.eligible ? "yes" : "no"} |`).join("\n")
  : "| _none_ | 0 | 0 | 0 | no |";
fs.writeFileSync(markdownPath, `# AIOS v1.1 evidence review\n\n- Status: **${result.status}**\n- Successful runs: **${result.evidence.successfulRuns}/${result.requirements.minimumSuccessfulRuns}**\n- Workflows exercised: **${result.evidence.workflowCount}**\n- Automatic language change allowed: **no**\n\n${result.decision.recommendation}\n\n| Candidate | Occurrences | Runs | Workflows | Eligible |\n|---|---:|---:|---:|---|\n${rows}\n`);
console.log(JSON.stringify({ ...result, outputPath, markdownPath }, null, 2));
