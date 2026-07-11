#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildProvenanceChain } from './v6-provenance-chain.mjs';

const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v7.replay_rollback_audit_summary';
const PROOF_SCHEMA = 'claw.synthetic_labor_os.v7.replay_rollback_audit';

function parseArgs(argv) {
  const args = {
    artifactRoot: 'artifacts/synthetic-labor-os-v7/latest',
    repoRoot: process.cwd(),
    chainPath: 'artifacts/synthetic-labor-os-v6/latest/v6_provenance_chain.json'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--repo-root') { args.repoRoot = next; index += 1; continue; }
    if (token === '--chain') { args.chainPath = next; index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v7-replay-rollback-audit.mjs [--artifact-root ROOT] [--chain PATH]');
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

function sha256FileIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function shellQuote(value = '') {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function runLogged(command, { cwd, logPath }) {
  const started = Date.now();
  const result = spawnSync(command, { cwd, shell: true, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const finished = Date.now();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, [
    `$ ${command}`,
    `cwd: ${cwd}`,
    `exitCode: ${result.status ?? 1}`,
    `signal: ${result.signal || ''}`,
    `durationMs: ${finished - started}`,
    '',
    '--- stdout ---',
    result.stdout || '',
    '--- stderr ---',
    result.stderr || '',
    ''
  ].join('\n'));
  return {
    command,
    ok: (result.status ?? 1) === 0,
    exitCode: result.status ?? 1,
    signal: result.signal || null,
    durationMs: finished - started,
    stdoutBytes: Buffer.byteLength(result.stdout || ''),
    stderrBytes: Buffer.byteLength(result.stderr || ''),
    logPath
  };
}

function copyJson(sourcePath, destPath, mutator) {
  const json = readJson(sourcePath, {});
  const next = mutator ? mutator(structuredClone(json)) : json;
  return writeJson(destPath, next);
}

function expectBlocked(chain, expectedFailure) {
  return {
    ok: chain.ok === false && (!expectedFailure || chain.failures.includes(expectedFailure)),
    chainOk: chain.ok,
    expectedFailure,
    observedFailures: chain.failures || [],
    blocker: chain.blocker || null
  };
}

function buildTamperCases({ chain, repoRoot, runDir }) {
  const v4SummaryPath = chain.artifacts?.v4Summary?.path;
  const v5SummaryPath = chain.artifacts?.v5Summary?.path;
  const approvalPath = chain.artifacts?.v5Approval?.path;
  const v5ProofPath = chain.artifacts?.v5ApplyProof?.path;
  const cases = [];

  const wrongApprovalPath = copyJson(approvalPath, path.join(runDir, 'tamper-wrong-approval.json'), (approval) => ({
    ...approval,
    patchSha256: `tampered-${approval.patchSha256 || 'missing'}`
  }));
  const wrongApprovalSummaryPath = copyJson(v5SummaryPath, path.join(runDir, 'tamper-wrong-approval-v5-summary.json'), (summary) => ({
    ...summary,
    approvalPath: wrongApprovalPath
  }));
  cases.push({
    name: 'wrong_patch_sha_in_approval',
    result: expectBlocked(buildProvenanceChain({ repoRoot, v4SummaryPath, v5SummaryPath: wrongApprovalSummaryPath }), 'approval_link_not_green')
  });

  const missingChangedTargetProofPath = copyJson(v5ProofPath, path.join(runDir, 'tamper-missing-changed-target-v5-proof.json'), (proof) => ({
    ...proof,
    targetSnapshots: { ...(proof.targetSnapshots || {}), changedTargets: [] }
  }));
  const missingChangedTargetSummaryPath = copyJson(v5SummaryPath, path.join(runDir, 'tamper-missing-changed-target-v5-summary.json'), (summary) => ({
    ...summary,
    proofPath: missingChangedTargetProofPath
  }));
  cases.push({
    name: 'missing_changed_target',
    result: expectBlocked(buildProvenanceChain({ repoRoot, v4SummaryPath, v5SummaryPath: missingChangedTargetSummaryPath }), 'apply_changed_targets_do_not_match_diff_paths')
  });

  const failedValidationProofPath = copyJson(v5ProofPath, path.join(runDir, 'tamper-failed-validation-v5-proof.json'), (proof) => ({
    ...proof,
    gates: {
      ...(proof.gates || {}),
      validationRuns: [{ command: 'tampered validation', ok: false, exitCode: 1, durationMs: 1 }]
    }
  }));
  const failedValidationSummaryPath = copyJson(v5SummaryPath, path.join(runDir, 'tamper-failed-validation-v5-summary.json'), (summary) => ({
    ...summary,
    proofPath: failedValidationProofPath
  }));
  cases.push({
    name: 'failed_validation',
    result: expectBlocked(buildProvenanceChain({ repoRoot, v4SummaryPath, v5SummaryPath: failedValidationSummaryPath }), 'validation_link_not_green')
  });

  return cases;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const repoRoot = path.resolve(args.repoRoot);
  const artifactRoot = path.resolve(args.artifactRoot);
  const runDir = path.join(artifactRoot, 'replay_rollback_audit', generatedAt.replace(/[^0-9A-Za-z]/g, ''));
  const chainPath = path.resolve(args.chainPath);
  const chain = readJson(chainPath, null);
  const failures = [];
  if (!chain) failures.push('missing_chain');
  if (chain && chain.ok !== true) failures.push('input_chain_not_green');

  const replayChain = chain ? buildProvenanceChain({
    repoRoot,
    v4SummaryPath: chain.artifacts?.v4Summary?.path,
    v5SummaryPath: chain.artifacts?.v5Summary?.path
  }) : null;
  if (replayChain?.ok !== true) failures.push('deterministic_replay_not_green');
  if (chain?.patch?.sha256 && replayChain?.patch?.sha256 !== chain.patch.sha256) failures.push('replay_patch_sha_changed');

  const patchPath = chain?.patch?.path;
  const applyContext = chain?.links?.apply?.gitApplyContext || {};
  const reverseCheck = chain ? runLogged(
    `git apply --reverse --check --whitespace=nowarn${applyContext.directoryArg || ''} ${shellQuote(patchPath)}`,
    { cwd: applyContext.cwd || repoRoot, logPath: path.join(runDir, 'git_apply_reverse_check.log') }
  ) : null;
  if (reverseCheck?.ok !== true) failures.push('rollback_reverse_check_failed');

  const tamperCases = chain ? buildTamperCases({ chain, repoRoot, runDir }) : [];
  for (const tamperCase of tamperCases) {
    if (tamperCase.result.ok !== true) failures.push(`tamper_case_did_not_block:${tamperCase.name}`);
  }

  const ok = failures.length === 0;
  const proof = {
    schemaVersion: PROOF_SCHEMA,
    generatedAt,
    ok,
    status: ok ? 'green_replay_rollback_and_tamper_checks' : 'blocked',
    repoRoot,
    inputChainPath: chainPath,
    inputChainSha256: sha256FileIfExists(chainPath),
    replay: {
      ok: replayChain?.ok === true,
      replayPatchSha256: replayChain?.patch?.sha256 || null,
      inputPatchSha256: chain?.patch?.sha256 || null,
      chainId: replayChain?.chainId || null
    },
    rollback: {
      mode: 'dry_run_reverse_check_only',
      ok: reverseCheck?.ok === true,
      command: reverseCheck?.command || null,
      logPath: reverseCheck?.logPath || null,
      changedWorktree: false
    },
    tamperChecks: tamperCases,
    failures,
    blocker: ok ? null : { blockerKind: 'v7_replay_rollback_audit_failed', blocker: `v7 replay/rollback audit failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'v7 proves the v6 chain replays deterministically, the applied patch has a rollback dry-run path, and selected tamper cases fail closed. It does not roll back, merge, publish, deploy, or send externally.'
      : 'v7 is blocked; do not claim rollback/tamper hardening until replay, reverse-check, and negative cases are green.'
  };
  const proofPath = writeJson(path.join(artifactRoot, 'v7_replay_rollback_audit.json'), proof);
  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt,
    ok,
    status: proof.status,
    proofPath,
    replayOk: proof.replay.ok,
    rollbackDryRunOk: proof.rollback.ok,
    tamperCaseCount: tamperCases.length,
    tamperCasesBlocked: tamperCases.filter((entry) => entry.result.ok).length,
    blocker: proof.blocker,
    truthBoundary: proof.truthBoundary
  };
  const summaryPath = writeJson(path.join(artifactRoot, 'v7_replay_rollback_audit_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (!ok) process.exitCode = 1;
}

export { buildTamperCases };

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
