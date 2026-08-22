#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APPLY_GATE_SCHEMA = 'claw.synthetic_labor_os.v5.patch_apply_gate';
const APPROVAL_SCHEMA = 'claw.synthetic_labor_os.v5.patch_apply_approval';

function parseArgs(argv) {
  const args = {
    patchPath: null,
    approvalPath: null,
    artifactRoot: 'artifacts/synthetic-labor-os-v5/latest',
    repoRoot: process.cwd(),
    allowedTargets: [],
    validationCommands: [],
    actor: 'synthetic-labor-os-apply-patch-gate'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--patch') { args.patchPath = next; index += 1; continue; }
    if (token === '--approval') { args.approvalPath = next; index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--repo-root') { args.repoRoot = next; index += 1; continue; }
    if (token === '--allowed-target') { args.allowedTargets.push(next); index += 1; continue; }
    if (token === '--validation-command') { args.validationCommands.push(next); index += 1; continue; }
    if (token === '--actor') { args.actor = next; index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log(`usage:
  node apps/synthetic-labor-os/apply-patch-gate.mjs --patch PATCH --approval APPROVAL --artifact-root ROOT [--allowed-target PATH] [--validation-command CMD]

Requires an explicit approval artifact, applies a bounded patch to the selected worktree, runs validation, and writes proof. It does not merge, publish, deploy, or send externally.`);
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!args.patchPath) throw new Error('--patch PATCH is required');
  if (!args.approvalPath) throw new Error('--approval APPROVAL is required');
  if (!args.allowedTargets.length) throw new Error('at least one --allowed-target is required');
  if (!args.validationCommands.length) args.validationCommands = ['node --test tests/synthetic-labor-os.test.mjs tests/synthetic-labor-os-remote-smoke.test.mjs'];
  return args;
}

function safeFileStamp(value = new Date().toISOString()) {
  return String(value).replace(/[^0-9A-Za-z_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256FileIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return sha256File(filePath);
  } catch {
    return null;
  }
}

function normalizeRelPath(relPath = '') {
  const normalized = String(relPath || '').replace(/^\/+/, '').replace(/^a\//, '').replace(/^b\//, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) return null;
  return normalized;
}

function extractDiffPaths(diff = '') {
  const paths = new Set();
  for (const line of String(diff || '').split(/\r?\n/)) {
    let match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) {
      for (const candidate of [match[1], match[2]]) {
        const normalized = normalizeRelPath(candidate);
        if (normalized) paths.add(normalized);
      }
      continue;
    }
    match = line.match(/^(?:---|\+\+\+) (?:a\/|b\/)?(.+)$/);
    if (match && match[1] !== '/dev/null') {
      const normalized = normalizeRelPath(match[1]);
      if (normalized) paths.add(normalized);
    }
  }
  return Array.from(paths).sort();
}

function snapshotTargets(repoRoot, relPaths = []) {
  const snapshot = {};
  for (const relPath of relPaths) {
    const normalized = normalizeRelPath(relPath);
    if (!normalized) continue;
    const absolutePath = path.join(repoRoot, normalized);
    snapshot[normalized] = {
      exists: fs.existsSync(absolutePath),
      sha256: sha256FileIfExists(absolutePath),
      sizeBytes: fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile() ? fs.statSync(absolutePath).size : null
    };
  }
  return snapshot;
}

function runLogged(command, { cwd, logPath }) {
  const started = Date.now();
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  const finished = Date.now();
  if (logPath) {
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
  }
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

function shellQuote(value = '') {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function resolveGitApplyContext(repoRoot) {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  });
  if ((result.status ?? 1) !== 0) {
    return { cwd: repoRoot, directoryArg: '', gitTopLevel: repoRoot, relativeRepoPath: '' };
  }
  const gitTopLevel = path.resolve(String(result.stdout || '').trim());
  const relativeRepoPath = path.relative(gitTopLevel, repoRoot);
  return {
    cwd: gitTopLevel,
    directoryArg: relativeRepoPath ? ` --directory=${shellQuote(relativeRepoPath)}` : '',
    gitTopLevel,
    relativeRepoPath
  };
}

function verifyApproval({ approval, patchSha256, patchPath, allowedTargets, diffPaths }) {
  const failures = [];
  if (!approval || typeof approval !== 'object') failures.push('missing_approval_json');
  if (approval?.schemaVersion && approval.schemaVersion !== APPROVAL_SCHEMA) failures.push('approval_schema_mismatch');
  if (approval?.approved !== true) failures.push('approval_not_true');
  if (!String(approval?.actor || '').trim()) failures.push('missing_approval_actor');
  if (!String(approval?.approvedAt || '').trim()) failures.push('missing_approved_at');
  if (approval?.patchSha256 && approval.patchSha256 !== patchSha256) failures.push('approval_patch_sha_mismatch');
  if (approval?.patchPath && path.resolve(approval.patchPath) !== path.resolve(patchPath)) failures.push('approval_patch_path_mismatch');
  const approvedTargets = new Set((approval?.approvedTargets || approval?.allowedTargets || []).map(normalizeRelPath).filter(Boolean));
  if (approvedTargets.size) {
    for (const diffPath of diffPaths) if (!approvedTargets.has(diffPath)) failures.push(`diff_path_not_approved:${diffPath}`);
  }
  const allowed = new Set(allowedTargets.map(normalizeRelPath).filter(Boolean));
  for (const diffPath of diffPaths) if (!allowed.has(diffPath)) failures.push(`diff_path_not_allowed:${diffPath}`);
  return {
    ok: failures.length === 0,
    failures,
    actor: approval?.actor || null,
    approvedAt: approval?.approvedAt || null,
    approvalId: approval?.approvalId || null,
    approvedTargets: Array.from(approvedTargets).sort(),
    truthBoundary: failures.length === 0
      ? 'Approval artifact permits this bounded patch application only.'
      : 'Approval artifact is insufficient; do not apply the patch.'
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const repoRoot = path.resolve(args.repoRoot);
  const patchPath = path.resolve(args.patchPath);
  const approvalPath = path.resolve(args.approvalPath);
  const artifactRoot = path.resolve(args.artifactRoot);
  const runDir = path.join(artifactRoot, 'patch_apply_gate', safeFileStamp(generatedAt));
  fs.mkdirSync(runDir, { recursive: true });

  const patchText = fs.readFileSync(patchPath, 'utf8');
  const patchSha256 = sha256File(patchPath);
  const diffPaths = extractDiffPaths(patchText);
  const allTargets = Array.from(new Set([...args.allowedTargets.map(normalizeRelPath).filter(Boolean), ...diffPaths]));
  const approval = readJson(approvalPath, null);
  const approvalVerification = verifyApproval({ approval, patchSha256, patchPath, allowedTargets: args.allowedTargets, diffPaths });
  const gitApplyContext = resolveGitApplyContext(repoRoot);
  const beforeTargetSnapshot = snapshotTargets(repoRoot, allTargets);
  const copiedPatchPath = path.join(runDir, 'approved_patch.diff');
  fs.copyFileSync(patchPath, copiedPatchPath);
  const copiedApprovalPath = path.join(runDir, 'operator_approval.json');
  fs.copyFileSync(approvalPath, copiedApprovalPath);

  const failures = [];
  if (!diffPaths.length) failures.push('patch_has_no_diff_paths');
  failures.push(...approvalVerification.failures);

  let checkRun = null;
  let applyRun = null;
  const validationRuns = [];
  if (!failures.length) {
    checkRun = runLogged(`git apply --check --whitespace=nowarn${gitApplyContext.directoryArg} ${shellQuote(copiedPatchPath)}`, {
      cwd: gitApplyContext.cwd,
      logPath: path.join(runDir, 'git_apply_check.log')
    });
    if (!checkRun.ok) failures.push('git_apply_check_failed');
  }
  if (!failures.length) {
    applyRun = runLogged(`git apply --whitespace=nowarn${gitApplyContext.directoryArg} ${shellQuote(copiedPatchPath)}`, {
      cwd: gitApplyContext.cwd,
      logPath: path.join(runDir, 'git_apply.log')
    });
    if (!applyRun.ok) failures.push('git_apply_failed');
  }
  const afterApplySnapshot = snapshotTargets(repoRoot, allTargets);
  const changedTargets = allTargets.filter((target) => JSON.stringify(beforeTargetSnapshot[target]) !== JSON.stringify(afterApplySnapshot[target]));
  if (!failures.length) {
    for (const diffPath of diffPaths) {
      if (!changedTargets.includes(diffPath)) failures.push(`diff_path_not_changed:${diffPath}`);
    }
  }
  if (!failures.length) {
    args.validationCommands.forEach((command, index) => {
      const run = runLogged(command, {
        cwd: repoRoot,
        logPath: path.join(runDir, `validation-${String(index + 1).padStart(2, '0')}.log`)
      });
      validationRuns.push(run);
      if (!run.ok) failures.push(`validation_failed:${command}`);
    });
  }
  const finalTargetSnapshot = snapshotTargets(repoRoot, allTargets);
  const ok = failures.length === 0;
  const proof = {
    schemaVersion: APPLY_GATE_SCHEMA,
    generatedAt: new Date().toISOString(),
    ok,
    patchApplied: applyRun?.ok === true,
    implementationClaimAllowedForApprovedPatch: ok,
    artifactDir: runDir,
    repoRoot,
    actor: args.actor,
    gitApplyContext,
    patch: {
      sourcePath: patchPath,
      copiedPath: copiedPatchPath,
      sha256: patchSha256,
      diffPaths,
      allowedTargets: args.allowedTargets.map(normalizeRelPath).filter(Boolean).sort()
    },
    approval: {
      sourcePath: approvalPath,
      copiedPath: copiedApprovalPath,
      verification: approvalVerification,
      raw: approval
    },
    gates: {
      gitApplyCheck: checkRun,
      gitApply: applyRun,
      validationRuns
    },
    targetSnapshots: {
      before: beforeTargetSnapshot,
      afterApply: afterApplySnapshot,
      final: finalTargetSnapshot,
      changedTargets
    },
    failures,
    blocker: ok ? null : { blockerKind: 'patch_apply_gate_failed', blocker: `Patch apply gate failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'Approved patch was applied to this worktree and validation passed. This is not a merge, publish, deploy, external send, or broad product claim.'
      : 'Patch apply gate is red; do not claim implementation, merge, publish, deploy, or send externally.'
  };
  const proofPath = writeJson(path.join(runDir, 'patch_apply_gate_proof.json'), proof);
  const summaryPath = writeJson(path.join(artifactRoot, 'v5_patch_apply_gate_summary.json'), {
    schemaVersion: 'claw.synthetic_labor_os.v5.patch_apply_gate_summary',
    generatedAt: proof.generatedAt,
    ok: proof.ok,
    patchApplied: proof.patchApplied,
    implementationClaimAllowedForApprovedPatch: proof.implementationClaimAllowedForApprovedPatch,
    patchSha256,
    diffPaths,
    changedTargets,
    proofPath,
    blocker: proof.blocker,
    truthBoundary: proof.truthBoundary
  });

  console.log(JSON.stringify({
    ok: proof.ok,
    patchApplied: proof.patchApplied,
    implementationClaimAllowedForApprovedPatch: proof.implementationClaimAllowedForApprovedPatch,
    diffPaths,
    changedTargets,
    proofPath,
    summaryPath,
    blocker: proof.blocker,
    truthBoundary: proof.truthBoundary
  }, null, 2));
  if (!ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
