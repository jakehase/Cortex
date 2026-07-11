#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPORT_SCHEMA = 'claw.synthetic_labor_os.v9.finished_claim_report';
const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v9.finished_claim_report_summary';

function parseArgs(argv) {
  const args = {
    artifactRoot: 'artifacts/synthetic-labor-os-v9/latest',
    repoRoot: process.cwd(),
    v0MatrixPath: 'artifacts/synthetic-labor-os-v0/latest/capability_matrix.json',
    v6SummaryPath: 'artifacts/synthetic-labor-os-v6/latest/v6_provenance_chain_summary.json',
    v7SummaryPath: 'artifacts/synthetic-labor-os-v7/latest/v7_replay_rollback_audit_summary.json',
    v8SummaryPath: 'artifacts/synthetic-labor-os-v8/latest/v8_e2e_demo_summary.json'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--repo-root') { args.repoRoot = next; index += 1; continue; }
    if (token === '--v0-matrix') { args.v0MatrixPath = next; index += 1; continue; }
    if (token === '--v6-summary') { args.v6SummaryPath = next; index += 1; continue; }
    if (token === '--v7-summary') { args.v7SummaryPath = next; index += 1; continue; }
    if (token === '--v8-summary') { args.v8SummaryPath = next; index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v9-finished-claim-report.mjs [--artifact-root ROOT] [--v8-summary PATH]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Synthetic Labor OS v9 Finished-Claim Report');
  lines.push('');
  lines.push(`- Status: ${report.ok ? 'green' : 'blocked'}`);
  lines.push(`- Finished claim allowed: ${report.finishedClaimAllowed}`);
  lines.push(`- v0 matrix ready: ${report.requirements.v0ProductReady.ok}`);
  lines.push(`- Provenance chain green: ${report.requirements.v6ProvenanceChain.ok}`);
  lines.push(`- Replay/rollback/tamper green: ${report.requirements.v7ReplayRollbackAudit.ok}`);
  lines.push(`- E2E demo green: ${report.requirements.v8E2eDemo.ok}`);
  lines.push(`- Blocker: ${report.blocker?.blocker || 'none'}`);
  lines.push('');
  lines.push('## Claim');
  lines.push(report.claimText);
  lines.push('');
  lines.push(`Truth boundary: ${report.truthBoundary}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function requirement(id, title, ok, artifact, details = {}) {
  return { id, title, ok, artifact, details };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const artifactRoot = path.resolve(args.artifactRoot);
  const v0MatrixPath = path.resolve(args.v0MatrixPath);
  const v6SummaryPath = path.resolve(args.v6SummaryPath);
  const v7SummaryPath = path.resolve(args.v7SummaryPath);
  const v8SummaryPath = path.resolve(args.v8SummaryPath);

  const v0Matrix = readJson(v0MatrixPath, null);
  const v6Summary = readJson(v6SummaryPath, null);
  const v7Summary = readJson(v7SummaryPath, null);
  const v8Summary = readJson(v8SummaryPath, null);

  const requirements = {
    v0ProductReady: requirement('v0_product_ready', 'Audited v0 product matrix is green', v0Matrix?.summary?.v0ProductReady === true, v0MatrixPath, {
      primitive: v0Matrix?.summary?.byPrimitiveStatus || null,
      product: v0Matrix?.summary?.byOsProductStatus || null,
      honestClaim: v0Matrix?.summary?.honestClaim || null
    }),
    v6ProvenanceChain: requirement('v6_provenance_chain', 'Proposal→approval→apply→validation chain is green', v6Summary?.ok === true, v6SummaryPath, {
      status: v6Summary?.status || null,
      patchSha256: v6Summary?.patchSha256 || null
    }),
    v7ReplayRollbackAudit: requirement('v7_replay_rollback_audit', 'Replay, rollback dry-run, and tamper checks are green', v7Summary?.ok === true, v7SummaryPath, {
      replayOk: v7Summary?.replayOk ?? null,
      rollbackDryRunOk: v7Summary?.rollbackDryRunOk ?? null,
      tamperCaseCount: v7Summary?.tamperCaseCount ?? null,
      tamperCasesBlocked: v7Summary?.tamperCasesBlocked ?? null
    }),
    v8E2eDemo: requirement('v8_e2e_demo', 'One-command E2E demo over existing real artifacts is green', v8Summary?.ok === true, v8SummaryPath, {
      sourceMode: v8Summary?.sourceMode || null,
      greenStepCount: v8Summary?.greenStepCount ?? null,
      stepCount: v8Summary?.stepCount ?? null
    })
  };

  const failures = Object.values(requirements)
    .filter((entry) => !entry.ok)
    .map((entry) => `requirement_not_green:${entry.id}`);
  const ok = failures.length === 0;
  const report = {
    schemaVersion: REPORT_SCHEMA,
    generatedAt,
    ok,
    status: ok ? 'green_finished_claim_report' : 'blocked',
    finishedClaimAllowed: ok,
    claimText: ok
      ? 'Synthetic Labor OS v0 productization is finished for the bounded v10 sequence when paired with a green v10 scale smoke: v0 matrix, one real remote proposal/apply lineage, replay/rollback/tamper checks, and one-command E2E demo are green.'
      : 'Synthetic Labor OS is not finished for the bounded v10 sequence; one or more report requirements are red or missing.',
    requirements,
    failures,
    blocker: ok ? null : { blockerKind: 'v9_finished_claim_report_failed', blocker: `v9 finished-claim report failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'v9 authorizes only a bounded internal finished claim for the SLOS v0/v10 productization sequence after v10 scale smoke is also green. It does not merge, publish, deploy, send externally, or claim full autonomous labor replacement.'
      : 'v9 is blocked; do not use a finished claim until all required evidence is green.'
  };
  const reportPath = writeJson(path.join(artifactRoot, 'v9_finished_claim_report.json'), report);
  const markdownPath = path.join(artifactRoot, 'v9_finished_claim_report.md');
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt,
    ok,
    status: report.status,
    finishedClaimAllowed: report.finishedClaimAllowed,
    reportPath,
    markdownPath,
    requirementCount: Object.keys(requirements).length,
    greenRequirementCount: Object.values(requirements).filter((entry) => entry.ok).length,
    blocker: report.blocker,
    truthBoundary: report.truthBoundary
  };
  const summaryPath = writeJson(path.join(artifactRoot, 'v9_finished_claim_report_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (!ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
