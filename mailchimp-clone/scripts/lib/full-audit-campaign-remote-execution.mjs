import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { shouldFinalizeRemoteExecutionMonitor, writeJson } from '../../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { buildExecutionBoundaryBlocker } from './full-audit-campaign-architecture.mjs';
import { buildDetachedRemoteLaunchCommand, buildRemoteRuntimeCandidates, selectRemoteRuntimeCandidate } from './full-audit-campaign-remote-contract.mjs';
import { deriveCanonicalStatuses, isArtifactFreshForRun, resolveCampaignBlocker } from './full-audit-campaign-state.mjs';
import { buildControlPlaneOverlaySyncPathspecs, parsePorcelainStatus, statusRepresentsDeletion } from './full-audit-campaign-sync-pathspecs.mjs';

const REMOTE_CONTROL_FILE_MANIFEST = [
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'artifacts/full_audit_campaign/strict_1to1_gap_inventory.json' },
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'artifacts/full_audit_campaign/one_pass_run_contract.latest.json' },
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'scripts/full-audit-campaign-remote-runner.mjs' },
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'scripts/orchestrator-real-repo-clean-run.mjs' },
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'scripts/orchestrator-real-repo-clean-worker.mjs' },
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'scripts/orchestrator-real-repo-clean-verifier.mjs' },
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'scripts/orchestrator-real-repo-clean-supervisor.mjs' },
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'scripts/orchestrator-real-repo-clean-implement.mjs' },
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'scripts/lib/full-audit-campaign-remote-contract.mjs' },
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'scripts/lib/full-audit-campaign-state.mjs' },
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'scripts/lib/full-audit-campaign-sync-pathspecs.mjs' },
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'scripts/lib/full-audit-campaign-liveness.mjs' },
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'scripts/lib/mailchimp-canonical-one-pass-plan-data.mjs' },
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'scripts/lib/strict-hierarchical-planner.mjs' },
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'scripts/lib/orchestrator-real-repo-clean-plan.mjs' },
  { localRoot: 'mailchimp-clone', remoteRoot: 'mailchimp-clone', relativeFile: 'scripts/smoke-full-clone.mjs' },
  { localRoot: 'large-project-capability-stack', remoteRoot: 'large-project-capability-stack', relativeFile: 'packages/campaign-runtime/index.mjs' },
  { localRoot: 'large-project-capability-stack', remoteRoot: 'large-project-capability-stack', relativeFile: 'packages/task-contract/index.mjs' },
  { localRoot: 'large-project-capability-stack', remoteRoot: 'large-project-capability-stack', relativeFile: 'packages/issue-dag/index.mjs' },
  { localRoot: 'large-project-capability-stack', remoteRoot: 'large-project-capability-stack', relativeFile: 'packages/surface-matrix/index.mjs' },
  { localRoot: 'large-project-capability-stack', remoteRoot: 'large-project-capability-stack', relativeFile: 'packages/multi-agent-orchestrator/index.mjs' }
];

const LOCAL_REPO_DYNAMIC_SYNC_PATHSPECS = buildControlPlaneOverlaySyncPathspecs();

function resolveControlSyncRoots(repoRoot, remoteExecution) {
  const localRoots = {
    'mailchimp-clone': repoRoot,
    'large-project-capability-stack': path.resolve(repoRoot, '..', 'large-project-capability-stack')
  };
  const remoteRoots = {
    'mailchimp-clone': path.join(remoteExecution.workdir, 'mailchimp-clone'),
    'large-project-capability-stack': path.join(remoteExecution.workdir, 'large-project-capability-stack')
  };
  return { localRoots, remoteRoots };
}

function ensureDir(dirPath) { fs.mkdirSync(dirPath, { recursive: true }); }
function shellQuote(value) { return `'${String(value).replace(/'/g, `"'"'`)}'`; }
function relative(repoRoot, target) { return target ? path.relative(repoRoot, target) : null; }
function parseJson(text) { try { return JSON.parse(text); } catch { return null; } }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function requiredRemoteFields(remoteExecution = {}) { return ['host', 'user', 'workdir'].filter((field) => !remoteExecution?.[field]); }
function sha256Bytes(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function sshBaseArgs(remoteExecution = {}) {
  const args = [];
  if (remoteExecution.keyPath) args.push('-i', remoteExecution.keyPath);
  args.push('-p', String(remoteExecution.port || 22));
  args.push('-o', `BatchMode=${remoteExecution.batchMode === false ? 'no' : 'yes'}`);
  args.push('-o', `ConnectTimeout=${Number(remoteExecution.connectTimeoutSec || 10)}`);
  args.push('-o', `StrictHostKeyChecking=${remoteExecution.strictHostKeyChecking === false ? 'no' : 'yes'}`);
  if (remoteExecution.userKnownHostsFile) args.push('-o', `UserKnownHostsFile=${remoteExecution.userKnownHostsFile}`);
  if (remoteExecution.proxyJump) args.push('-J', remoteExecution.proxyJump);
  return args;
}

function remoteTarget(remoteExecution = {}) { return `${remoteExecution.user}@${remoteExecution.host}`; }
function buildSshArgs(remoteExecution, remoteCommand) { return [...sshBaseArgs(remoteExecution), remoteTarget(remoteExecution), remoteCommand]; }

function runSsh(remoteExecution, remoteCommand, { timeoutMs = 60_000, maxBuffer = 1024 * 1024 * 200 } = {}) {
  return spawnSync('ssh', buildSshArgs(remoteExecution, remoteCommand), { encoding: 'utf8', timeout: timeoutMs, maxBuffer });
}

function readRemoteFile(remoteExecution, filePath, { timeoutMs = 20_000 } = {}) {
  const remoteCommand = `python3 - <<'PY'\nfrom pathlib import Path\np = Path(${JSON.stringify(filePath)})\nif p.exists():\n    print(p.read_text())\nPY`;
  const result = runSsh(remoteExecution, remoteCommand, { timeoutMs });
  if (result.status !== 0 || result.error) return null;
  return String(result.stdout || '');
}

function readRemoteSha(remoteExecution, filePath, { timeoutMs = 20_000 } = {}) {
  const remoteCommand = `python3 - <<'PY'\nfrom pathlib import Path\nimport hashlib\np = Path(${JSON.stringify(filePath)})\nif p.exists():\n    print(hashlib.sha256(p.read_bytes()).hexdigest())\nPY`;
  const result = runSsh(remoteExecution, remoteCommand, { timeoutMs });
  if (result.status !== 0 || result.error) return null;
  return String(result.stdout || '').trim() || null;
}

function writeRemoteFile(remoteExecution, filePath, content, { timeoutMs = 60_000 } = {}) {
  const pythonSource = [
    'from pathlib import Path',
    'import sys',
    'p = Path(sys.argv[1])',
    'p.parent.mkdir(parents=True, exist_ok=True)',
    'p.write_bytes(sys.stdin.buffer.read())'
  ].join('\n');
  const remoteCommand = `python3 -c ${shellQuote(pythonSource)} ${shellQuote(filePath)}`;
  return spawnSync('ssh', buildSshArgs(remoteExecution, remoteCommand), {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 200,
    input: content
  });
}

function removeRemotePath(remoteExecution, filePath, { timeoutMs = 60_000 } = {}) {
  const pythonSource = [
    'from pathlib import Path',
    'import shutil',
    'import sys',
    'p = Path(sys.argv[1])',
    'if p.is_dir() and not p.is_symlink():',
    '    shutil.rmtree(p, ignore_errors=True)',
    'else:',
    '    p.unlink(missing_ok=True)'
  ].join('\n');
  const remoteCommand = `python3 -c ${shellQuote(pythonSource)} ${shellQuote(filePath)}`;
  return spawnSync('ssh', buildSshArgs(remoteExecution, remoteCommand), {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 20
  });
}

function localGitTopLevelForOverlay(repoRoot) {
  const result = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0 || result.error) return repoRoot;
  return String(result.stdout || '').trim() || repoRoot;
}

function normalizeLocalRepoOverlayPath({ repoRoot, gitTopLevel, recordPath }) {
  if (!recordPath) return recordPath;
  const normalizedRepoRoot = path.resolve(repoRoot);
  const normalizedGitTopLevel = path.resolve(gitTopLevel || repoRoot);
  const repoPrefix = path.relative(normalizedGitTopLevel, normalizedRepoRoot).split(path.sep).filter(Boolean).join('/');
  if (!repoPrefix || normalizedGitTopLevel === normalizedRepoRoot) return recordPath;
  if (recordPath === repoPrefix) return '.';
  if (recordPath.startsWith(`${repoPrefix}/`)) return recordPath.slice(repoPrefix.length + 1);
  return recordPath;
}

function normalizeLocalRepoOverlayRecordPaths(repoRoot, records) {
  const gitTopLevel = localGitTopLevelForOverlay(repoRoot);
  return records.map((record) => ({
    ...record,
    originalPath: record.path,
    originalFromPath: record.fromPath,
    path: normalizeLocalRepoOverlayPath({ repoRoot, gitTopLevel, recordPath: record.path }),
    fromPath: normalizeLocalRepoOverlayPath({ repoRoot, gitTopLevel, recordPath: record.fromPath })
  }));
}

function collectLocalRepoOverlayRecords(repoRoot) {
  const result = spawnSync('git', ['-C', repoRoot, 'status', '--porcelain', '-uall', '--', ...LOCAL_REPO_DYNAMIC_SYNC_PATHSPECS], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 1024 * 1024 * 50
  });
  if (result.status !== 0 || result.error) {
    const errorText = `${result.stdout || ''}${result.stderr || ''}${result.error ? `\n[spawn-error] ${String(result.error.message || result.error)}` : ''}`.trim();
    throw new Error(`Failed to collect local overlay status: ${errorText}`);
  }
  return normalizeLocalRepoOverlayRecordPaths(repoRoot, parsePorcelainStatus(String(result.stdout || '')));
}

function syncLocalRepoOverlayFiles({ repoRoot, remoteExecution, remoteRepoRoot, protectedPaths = [] }) {
  const records = collectLocalRepoOverlayRecords(repoRoot);
  const remoteBaselineCleanup = cleanupRemoteOverlayDrift({
    remoteExecution,
    remoteRepoRoot,
    expectedRecords: records,
    protectedPaths
  });
  const synced = [];
  const skipped = [];
  const deleted = [];
  for (const record of records) {
    if (!record?.path) continue;
    const remotePath = path.join(remoteRepoRoot, record.path);
    if (record.fromPath && record.fromPath !== record.path) {
      const priorRemotePath = path.join(remoteRepoRoot, record.fromPath);
      const removePrior = removeRemotePath(remoteExecution, priorRemotePath, { timeoutMs: 60_000 });
      if (removePrior.status !== 0 || removePrior.error) {
        const errorText = `${removePrior.stdout || ''}${removePrior.stderr || ''}${removePrior.error ? `\n[spawn-error] ${String(removePrior.error.message || removePrior.error)}` : ''}`.trim();
        throw new Error(`Failed to remove renamed remote path ${record.fromPath}: ${errorText}`);
      }
      deleted.push({ path: record.fromPath, via: 'rename_source' });
    }
    if (statusRepresentsDeletion(record.status)) {
      const removeResult = removeRemotePath(remoteExecution, remotePath, { timeoutMs: 60_000 });
      if (removeResult.status !== 0 || removeResult.error) {
        const errorText = `${removeResult.stdout || ''}${removeResult.stderr || ''}${removeResult.error ? `\n[spawn-error] ${String(removeResult.error.message || removeResult.error)}` : ''}`.trim();
        throw new Error(`Failed to remove remote overlay path ${record.path}: ${errorText}`);
      }
      deleted.push({ path: record.path, status: record.status });
      continue;
    }
    const localPath = path.join(repoRoot, record.path);
    if (!fs.existsSync(localPath)) {
      skipped.push({ path: record.path, status: record.status, reason: 'missing_local_source' });
      continue;
    }
    const localBytes = fs.readFileSync(localPath);
    const localSha = sha256Bytes(localBytes);
    const remoteSha = readRemoteSha(remoteExecution, remotePath, { timeoutMs: 20_000 });
    if (remoteSha === localSha) {
      skipped.push({ path: record.path, status: record.status, sha256: localSha, reason: 'sha_match' });
      continue;
    }
    const writeResult = writeRemoteFile(remoteExecution, remotePath, localBytes, { timeoutMs: 60_000 });
    if (writeResult.status !== 0 || writeResult.error) {
      const errorText = `${writeResult.stdout || ''}${writeResult.stderr || ''}${writeResult.error ? `\n[spawn-error] ${String(writeResult.error.message || writeResult.error)}` : ''}`.trim();
      throw new Error(`Failed to sync remote overlay file ${record.path}: ${errorText}`);
    }
    const verifiedRemoteSha = readRemoteSha(remoteExecution, remotePath, { timeoutMs: 20_000 });
    if (verifiedRemoteSha !== localSha) {
      throw new Error(`Failed to verify remote overlay file ${record.path}: expected ${localSha}, got ${verifiedRemoteSha || 'missing'}`);
    }
    synced.push({ path: record.path, status: record.status, sha256: localSha });
  }
  return {
    pathspecs: LOCAL_REPO_DYNAMIC_SYNC_PATHSPECS,
    changedRecordCount: records.length,
    remoteBaselineCleanup,
    synced,
    skipped,
    deleted
  };
}

function collectRemoteRepoOverlayRecords(remoteExecution, remoteRepoRoot) {
  const remoteCommand = `cd ${shellQuote(remoteRepoRoot)} && git status --porcelain -uall -- ${LOCAL_REPO_DYNAMIC_SYNC_PATHSPECS.map(shellQuote).join(' ')}`;
  const result = runSsh(remoteExecution, remoteCommand, { timeoutMs: 120_000, maxBuffer: 1024 * 1024 * 50 });
  if (result.status !== 0 || result.error) {
    const errorText = `${result.stdout || ''}${result.stderr || ''}${result.error ? `\n[spawn-error] ${String(result.error.message || result.error)}` : ''}`.trim();
    throw new Error(`Failed to collect remote overlay status: ${errorText}`);
  }
  return parsePorcelainStatus(String(result.stdout || ''));
}

function statusRepresentsUntracked(status = '') {
  return String(status).includes('?');
}

function restoreRemoteTrackedPath(remoteExecution, remoteRepoRoot, filePath) {
  const remoteCommand = `cd ${shellQuote(remoteRepoRoot)} && git checkout -- ${shellQuote(filePath)}`;
  return runSsh(remoteExecution, remoteCommand, { timeoutMs: 60_000, maxBuffer: 1024 * 1024 * 20 });
}

function cleanupRemoteOverlayDrift({ remoteExecution, remoteRepoRoot, expectedRecords = [], protectedPaths = [] }) {
  const expectedPaths = new Set(protectedPaths.filter(Boolean));
  for (const record of expectedRecords) {
    if (record?.path) expectedPaths.add(record.path);
    if (record?.fromPath) expectedPaths.add(record.fromPath);
  }
  const remoteRecords = collectRemoteRepoOverlayRecords(remoteExecution, remoteRepoRoot);
  const staleRecords = remoteRecords.filter((record) => record?.path && !expectedPaths.has(record.path));
  const reset = [];
  const removed = [];
  const skipped = [];
  for (const record of staleRecords) {
    if (statusRepresentsUntracked(record.status)) {
      const removeResult = removeRemotePath(remoteExecution, path.join(remoteRepoRoot, record.path), { timeoutMs: 60_000 });
      if (removeResult.status !== 0 || removeResult.error) {
        const errorText = `${removeResult.stdout || ''}${removeResult.stderr || ''}${removeResult.error ? `\n[spawn-error] ${String(removeResult.error.message || removeResult.error)}` : ''}`.trim();
        throw new Error(`Failed to remove stale remote overlay file ${record.path}: ${errorText}`);
      }
      removed.push({ path: record.path, status: record.status });
      continue;
    }
    if (record.fromPath && !expectedPaths.has(record.fromPath)) {
      const restoreSource = restoreRemoteTrackedPath(remoteExecution, remoteRepoRoot, record.fromPath);
      if (restoreSource.status !== 0 || restoreSource.error) {
        const errorText = `${restoreSource.stdout || ''}${restoreSource.stderr || ''}${restoreSource.error ? `\n[spawn-error] ${String(restoreSource.error.message || restoreSource.error)}` : ''}`.trim();
        throw new Error(`Failed to restore stale remote overlay source ${record.fromPath}: ${errorText}`);
      }
      reset.push({ path: record.fromPath, via: 'rename_source' });
    }
    const restoreResult = restoreRemoteTrackedPath(remoteExecution, remoteRepoRoot, record.path);
    if (restoreResult.status !== 0 || restoreResult.error) {
      const errorText = `${restoreResult.stdout || ''}${restoreResult.stderr || ''}${restoreResult.error ? `\n[spawn-error] ${String(restoreResult.error.message || restoreResult.error)}` : ''}`.trim();
      throw new Error(`Failed to restore stale remote overlay path ${record.path}: ${errorText}`);
    }
    reset.push({ path: record.path, status: record.status });
  }
  return {
    checkedRecordCount: remoteRecords.length,
    staleRecordCount: staleRecords.length,
    reset,
    removed,
    skipped
  };
}

function syncRemoteControlFiles({ repoRoot, remoteExecution }) {
  const synced = [];
  const skipped = [];
  const { localRoots, remoteRoots } = resolveControlSyncRoots(repoRoot, remoteExecution);
  for (const entry of REMOTE_CONTROL_FILE_MANIFEST) {
    const localBase = localRoots[entry.localRoot];
    const remoteBase = remoteRoots[entry.remoteRoot];
    if (!localBase || !fs.existsSync(localBase)) {
      throw new Error(`Missing local control-sync root ${entry.localRoot}`);
    }
    const localPath = path.join(localBase, entry.relativeFile);
    if (!fs.existsSync(localPath)) continue;
    const remotePath = path.join(remoteBase, entry.relativeFile);
    const localBytes = fs.readFileSync(localPath);
    const localSha = sha256Bytes(localBytes);
    const remoteSha = readRemoteSha(remoteExecution, remotePath, { timeoutMs: 20_000 });
    if (remoteSha === localSha) {
      skipped.push({ root: entry.remoteRoot, path: entry.relativeFile, sha256: localSha });
      continue;
    }
    const writeResult = writeRemoteFile(remoteExecution, remotePath, localBytes, { timeoutMs: 60_000 });
    if (writeResult.status !== 0 || writeResult.error) {
      const errorText = `${writeResult.stdout || ''}${writeResult.stderr || ''}${writeResult.error ? `\n[spawn-error] ${String(writeResult.error.message || writeResult.error)}` : ''}`.trim();
      throw new Error(`Failed to sync remote control file ${entry.remoteRoot}/${entry.relativeFile}: ${errorText}`);
    }
    const verifiedRemoteSha = readRemoteSha(remoteExecution, remotePath, { timeoutMs: 20_000 });
    if (verifiedRemoteSha !== localSha) {
      throw new Error(`Failed to verify remote control file ${entry.remoteRoot}/${entry.relativeFile}: expected ${localSha}, got ${verifiedRemoteSha || 'missing'}`);
    }
    synced.push({ root: entry.remoteRoot, path: entry.relativeFile, sha256: localSha });
  }
  const repoOverlay = syncLocalRepoOverlayFiles({
    repoRoot,
    remoteExecution,
    remoteRepoRoot: remoteRoots['mailchimp-clone'],
    protectedPaths: REMOTE_CONTROL_FILE_MANIFEST
      .filter((entry) => entry.remoteRoot === 'mailchimp-clone')
      .map((entry) => entry.relativeFile)
  });
  return {
    synced,
    skipped,
    repoOverlay,
    remoteRepoRoot: remoteRoots['mailchimp-clone'],
    remoteStackRepoRoot: remoteRoots['large-project-capability-stack']
  };
}

function buildRemoteFileMap(remoteArtifactRoot, remoteRunRoot) {
  return {
    completionSummary: path.join(remoteArtifactRoot, 'completion_summary.json'),
    programState: path.join(remoteArtifactRoot, 'program_state.json'),
    blocker: path.join(remoteArtifactRoot, 'blocker_report.json'),
    surfaceMatrix: path.join(remoteArtifactRoot, 'surface_matrix.json'),
    supervisorStatus: path.join(remoteArtifactRoot, 'supervisor_status.json'),
    remoteExecutionStatus: path.join(remoteArtifactRoot, 'remote_execution_status.json'),
    remoteExecutionTerminal: path.join(remoteArtifactRoot, 'remote_execution_terminal.json'),
    liveExecutionSummary: path.join(remoteArtifactRoot, 'live_execution_summary.json'),
    patchQueueReport: path.join(remoteArtifactRoot, 'patch_queue_report.json'),
    launchChecklist: path.join(remoteArtifactRoot, 'launch_checklist.json'),
    locAccounting: path.join(remoteArtifactRoot, 'loc_accounting.json'),
    remoteExecutionLog: path.join(remoteArtifactRoot, 'remote_execution.log'),
    implementationModeStatus: path.join(remoteArtifactRoot, 'implementation_mode_status.json'),
    canonicalSummary: path.join(remoteArtifactRoot, 'canonical_summary.json'),
    notifierEligibility: path.join(remoteArtifactRoot, 'notifier_eligibility.json'),
    baselineOverlay: path.join(remoteArtifactRoot, 'baseline_overlay.json'),
    dependencyLinks: path.join(remoteArtifactRoot, 'dependency_links.json'),
    launcherLog: path.join(remoteRunRoot, 'launcher.log'),
    launcherPid: path.join(remoteRunRoot, 'launcher.pid')
  };
}

function mirrorRemoteArtifacts({ repoRoot, remoteExecution, remoteArtifactRoot, remoteRunRoot, delegateArtifactRoot, delegateCompletionSummaryPath, delegateProgramStatePath, delegateBlockerPath, controlPlaneBlockerPath }) {
  const remoteFiles = buildRemoteFileMap(remoteArtifactRoot, remoteRunRoot);
  const mirrored = {};

  const mirrorOptionalFile = (text, localPath, key, { mirrorToControlPlane = null } = {}) => {
    if (text) {
      fs.writeFileSync(localPath, text);
      mirrored[key] = relative(repoRoot, localPath);
      if (mirrorToControlPlane) {
        fs.writeFileSync(mirrorToControlPlane, text);
        mirrored.controlPlaneBlockerPath = relative(repoRoot, mirrorToControlPlane);
      }
      return;
    }
    try { fs.rmSync(localPath, { force: true }); } catch {}
    if (mirrorToControlPlane) {
      try { fs.rmSync(mirrorToControlPlane, { force: true }); } catch {}
    }
  };

  const completionText = readRemoteFile(remoteExecution, remoteFiles.completionSummary);
  const programText = readRemoteFile(remoteExecution, remoteFiles.programState);
  const blockerText = readRemoteFile(remoteExecution, remoteFiles.blocker);
  const surfaceMatrixText = readRemoteFile(remoteExecution, remoteFiles.surfaceMatrix);
  const supervisorText = readRemoteFile(remoteExecution, remoteFiles.supervisorStatus);
  const remoteStatusText = readRemoteFile(remoteExecution, remoteFiles.remoteExecutionStatus);
  const remoteTerminalText = readRemoteFile(remoteExecution, remoteFiles.remoteExecutionTerminal);
  const liveExecutionSummaryText = readRemoteFile(remoteExecution, remoteFiles.liveExecutionSummary);
  const patchQueueReportText = readRemoteFile(remoteExecution, remoteFiles.patchQueueReport);
  const launchChecklistText = readRemoteFile(remoteExecution, remoteFiles.launchChecklist);
  const locAccountingText = readRemoteFile(remoteExecution, remoteFiles.locAccounting);
  const remoteLogText = readRemoteFile(remoteExecution, remoteFiles.remoteExecutionLog, { timeoutMs: 60_000 });
  const implementationModeText = readRemoteFile(remoteExecution, remoteFiles.implementationModeStatus);
  const canonicalSummaryText = readRemoteFile(remoteExecution, remoteFiles.canonicalSummary);
  const notifierEligibilityText = readRemoteFile(remoteExecution, remoteFiles.notifierEligibility);
  const baselineOverlayText = readRemoteFile(remoteExecution, remoteFiles.baselineOverlay);
  const dependencyLinksText = readRemoteFile(remoteExecution, remoteFiles.dependencyLinks);
  const launcherLogText = readRemoteFile(remoteExecution, remoteFiles.launcherLog, { timeoutMs: 30_000 });
  const launcherPidText = readRemoteFile(remoteExecution, remoteFiles.launcherPid, { timeoutMs: 20_000 });

  mirrorOptionalFile(completionText, delegateCompletionSummaryPath, 'completionSummaryPath');
  mirrorOptionalFile(programText, delegateProgramStatePath, 'programStatePath');
  mirrorOptionalFile(blockerText, delegateBlockerPath, 'blockerPath', { mirrorToControlPlane: controlPlaneBlockerPath });
  mirrorOptionalFile(surfaceMatrixText, path.join(delegateArtifactRoot, 'surface_matrix.json'), 'surfaceMatrixPath');
  if (supervisorText) {
    const localPath = path.join(delegateArtifactRoot, 'supervisor_status.json');
    mirrorOptionalFile(supervisorText, localPath, 'supervisorStatusPath');
  }
  mirrorOptionalFile(remoteStatusText, path.join(delegateArtifactRoot, 'remote_execution_status.json'), 'remoteExecutionStatusPath');
  mirrorOptionalFile(remoteTerminalText, path.join(delegateArtifactRoot, 'remote_execution_terminal.json'), 'remoteExecutionTerminalPath');
  mirrorOptionalFile(liveExecutionSummaryText, path.join(delegateArtifactRoot, 'live_execution_summary.json'), 'liveExecutionSummaryPath');
  mirrorOptionalFile(patchQueueReportText, path.join(delegateArtifactRoot, 'patch_queue_report.json'), 'patchQueueReportPath');
  mirrorOptionalFile(launchChecklistText, path.join(delegateArtifactRoot, 'launch_checklist.json'), 'launchChecklistPath');
  mirrorOptionalFile(locAccountingText, path.join(delegateArtifactRoot, 'loc_accounting.json'), 'locAccountingPath');
  mirrorOptionalFile(remoteLogText, path.join(delegateArtifactRoot, 'remote_execution.log'), 'remoteExecutionLogPath');
  mirrorOptionalFile(implementationModeText, path.join(delegateArtifactRoot, 'implementation_mode_status.json'), 'implementationModeStatusPath');
  mirrorOptionalFile(canonicalSummaryText, path.join(delegateArtifactRoot, 'canonical_summary.json'), 'canonicalSummaryPath');
  mirrorOptionalFile(notifierEligibilityText, path.join(delegateArtifactRoot, 'notifier_eligibility.json'), 'notifierEligibilityPath');
  mirrorOptionalFile(baselineOverlayText, path.join(delegateArtifactRoot, 'baseline_overlay.json'), 'baselineOverlayPath');
  mirrorOptionalFile(dependencyLinksText, path.join(delegateArtifactRoot, 'dependency_links.json'), 'dependencyLinksPath');
  mirrorOptionalFile(launcherLogText, path.join(delegateArtifactRoot, 'launcher.log'), 'launcherLogPath');
  mirrorOptionalFile(launcherPidText, path.join(delegateArtifactRoot, 'launcher.pid'), 'launcherPidPath');

  return {
    mirrored,
    remoteExecutionStatus: parseJson(remoteStatusText || ''),
    remoteExecutionTerminal: parseJson(remoteTerminalText || ''),
    remoteLiveExecutionSummary: parseJson(liveExecutionSummaryText || ''),
    remotePatchQueueReport: parseJson(patchQueueReportText || ''),
    remoteLaunchChecklist: parseJson(launchChecklistText || ''),
    remoteLocAccounting: parseJson(locAccountingText || ''),
    remoteCompletionSummary: parseJson(completionText || ''),    remoteProgramState: parseJson(programText || ''),
    remoteBlocker: parseJson(blockerText || ''),
    remoteCanonicalSummary: parseJson(canonicalSummaryText || ''),
    remoteNotifierEligibility: parseJson(notifierEligibilityText || ''),
    remoteBaselineOverlay: parseJson(baselineOverlayText || ''),
    remoteDependencyLinks: parseJson(dependencyLinksText || ''),
    remoteLauncherPid: launcherPidText ? String(launcherPidText).trim() : null
  };
}

function parseLaunchPid(result) {
  const text = `${result.stdout || ''}`.trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidate = lines.at(-1);
  return candidate && /^\d+$/.test(candidate) ? Number(candidate) : null;
}

function checkRemotePidAlive(remoteExecution, pid) {
  if (!pid) return null;
  const result = runSsh(remoteExecution, `bash -lc 'kill -0 ${Number(pid)} >/dev/null 2>&1 && echo alive || echo dead'`, { timeoutMs: 20_000 });
  if (result.status !== 0 || result.error) return null;
  const verdict = String(result.stdout || '').trim();
  return verdict === 'alive' ? true : verdict === 'dead' ? false : null;
}

function buildRemoteWatchdogBlocker({ runId, remoteArtifactRoot, reason, nextAction, launchPid = null, remoteRunnerPid = null, heartbeatAgeSec = null, startupAgeSec = null, currentTestHint = null, launcherAlive = null, runnerAlive = null }) {
  return {
    generatedAt: new Date().toISOString(),
    blocker: reason,
    nextAction,
    runId,
    remoteArtifactRoot,
    launchPid,
    remoteRunnerPid,
    heartbeatAgeSec,
    startupAgeSec,
    currentTestHint,
    launcherAlive,
    runnerAlive
  };
}

function deriveMirroredTerminalState({ effectiveRunId, startedAt, mirror }) {
  const currentRun = {
    runId: effectiveRunId,
    generatedAt: startedAt,
    startedAt
  };
  const terminalStatus = mirror.remoteExecutionTerminal || null;
  const blocker = resolveCampaignBlocker({
    completionSummary: mirror.remoteCompletionSummary,
    programState: mirror.remoteProgramState,
    canonicalSummary: mirror.remoteCanonicalSummary,
    blockerReport: mirror.remoteBlocker
  });
  const freshArtifacts = {
    remoteExecutionTerminal: isArtifactFreshForRun({ artifact: terminalStatus, currentRun, runId: effectiveRunId, requireRunMatch: false, timestampKeys: ['finishedAt', 'generatedAt', 'startedAt'] }),
    completionSummary: isArtifactFreshForRun({ artifact: mirror.remoteCompletionSummary, currentRun, runId: effectiveRunId, requireRunMatch: false }),
    programState: isArtifactFreshForRun({ artifact: mirror.remoteProgramState, currentRun, runId: effectiveRunId, requireRunMatch: false }),
    canonicalSummary: isArtifactFreshForRun({ artifact: mirror.remoteCanonicalSummary, currentRun, runId: effectiveRunId, requireRunMatch: false }),
    notifierEligibility: isArtifactFreshForRun({ artifact: mirror.remoteNotifierEligibility, currentRun, runId: effectiveRunId, requireRunMatch: false })
  };
  const anyFreshTerminalArtifact = Object.values(freshArtifacts).some(Boolean);
  const statuses = deriveCanonicalStatuses({
    completionSummary: mirror.remoteCompletionSummary,
    programState: mirror.remoteProgramState,
    canonicalSummary: mirror.remoteCanonicalSummary,
    blocker
  });
  const notifierKind = mirror.remoteNotifierEligibility?.kind || null;
  const terminalReceiptSuccess = freshArtifacts.remoteExecutionTerminal && terminalStatus?.terminal === true && terminalStatus?.ok === true;
  const terminalReceiptBlocked = freshArtifacts.remoteExecutionTerminal && terminalStatus?.terminal === true && Boolean(terminalStatus?.blocker || blocker);
  const success = !blocker && (terminalReceiptSuccess || (statuses.green && (anyFreshTerminalArtifact || notifierKind === 'success')));
  const blocked = Boolean(blocker) && (terminalReceiptBlocked || anyFreshTerminalArtifact || notifierKind === 'blocker' || Boolean(mirror.remoteBlocker));
  return {
    terminal: success || blocked,
    success,
    blocked,
    blocker: blocker || null,
    statuses,
    freshArtifacts,
    anyFreshTerminalArtifact,
    notifierKind,
    remoteExecutionTerminal: terminalStatus
  };
}

function buildRunningStatusMirror({ repoRoot, logPath, transportStatusPath, policyPath, requestedAgentCount, effectiveRunId, remoteExecution, remoteRunsRoot, remoteRunRoot, remoteLaunchScript, remoteArtifactRoot, syncSummary, pollCount, lastPolledAt, launchPid, mirror, remoteWatchdog = null }) {
  const remoteStatus = mirror.remoteExecutionStatus || null;
  const remoteHeartbeatAt = remoteStatus?.heartbeatAt || remoteStatus?.generatedAt || null;
  const heartbeatAgeSec = remoteHeartbeatAt ? Math.max(0, Math.round((Date.now() - Date.parse(remoteHeartbeatAt)) / 1000)) : null;
  return {
    generatedAt: new Date().toISOString(),
    ok: null,
    running: true,
    phase: remoteWatchdog ? 'remote_execution_watchdog_warning' : 'remote_execution_monitoring',
    requestedAgentCount,
    runId: effectiveRunId,
    launchPid,
    pollCount,
    lastPolledAt,
    logPath: relative(repoRoot, logPath),
    transportStatusPath: relative(repoRoot, transportStatusPath),
    executionBoundaryPolicyPath: relative(repoRoot, policyPath),
    remoteExecution: {
      host: remoteExecution.host,
      user: remoteExecution.user,
      port: remoteExecution.port || 22,
      workdir: remoteExecution.workdir,
      runsRoot: remoteRunsRoot,
      remoteRunRoot,
      launchScript: remoteLaunchScript,
      remoteArtifactRoot,
      heartbeatAgeSec
    },
    syncedRemoteControlFiles: syncSummary,
    mirrored: mirror.mirrored,
    remoteExecutionStatus: remoteStatus,
    remoteExecutionTerminal: mirror.remoteExecutionTerminal,
    remoteCompletionSummary: mirror.remoteCompletionSummary,
    remoteProgramState: mirror.remoteProgramState,
    remoteBlocker: mirror.remoteBlocker || null,
    remoteCanonicalSummary: mirror.remoteCanonicalSummary,
    remoteNotifierEligibility: mirror.remoteNotifierEligibility,
    remoteBaselineOverlay: mirror.remoteBaselineOverlay,
    remoteDependencyLinks: mirror.remoteDependencyLinks,
    remoteLauncherPid: mirror.remoteLauncherPid,
    remoteWatchdog,
    note: remoteWatchdog
      ? 'Remote execution is still marked running, but the watchdog detected stale liveness and is preparing to stop the monitoring pass.'
      : 'Heavy execution is active on the execution-plane host.'
  };
}

function buildStartupStatusMirror({ repoRoot, logPath, transportStatusPath, policyPath, requestedAgentCount, effectiveRunId, remoteExecution, remoteRunsRoot, remoteRunRoot, remoteLaunchScript, remoteArtifactRoot, syncSummary, launchPid }) {
  return {
    generatedAt: new Date().toISOString(),
    ok: null,
    running: true,
    phase: 'remote_execution_detached_launched',
    requestedAgentCount,
    runId: effectiveRunId,
    launchPid,
    logPath: relative(repoRoot, logPath),
    transportStatusPath: relative(repoRoot, transportStatusPath),
    executionBoundaryPolicyPath: relative(repoRoot, policyPath),
    remoteExecution: {
      host: remoteExecution.host,
      user: remoteExecution.user,
      port: remoteExecution.port || 22,
      workdir: remoteExecution.workdir,
      runsRoot: remoteRunsRoot,
      remoteRunRoot,
      launchScript: remoteLaunchScript,
      remoteArtifactRoot
    },
    syncedRemoteControlFiles: syncSummary,
    note: 'Heavy execution was launched in detached mode on the execution-plane host; control plane is monitoring artifacts and heartbeats.'
  };
}

export async function submitRemoteCampaignWorker({
  repoRoot,
  artifactRoot,
  reportsDir,
  workerStatePath,
  logPath,
  statusMirrorPath,
  delegateArtifactRoot,
  delegateCompletionSummaryPath,
  delegateProgramStatePath,
  delegateBlockerPath,
  controlPlaneBlockerPath,
  transportStatusPath,
  role,
  threadContext,
  transportStatus,
  remoteExecution,
  policyPath,
  policy,
  executionDecision,
  emitSessionEvent = null,
  requestedAgentCount = 100,
  runId
}) {
  ensureDir(artifactRoot);
  ensureDir(reportsDir);
  ensureDir(delegateArtifactRoot);
  fs.writeFileSync(logPath, '');

  const missing = requiredRemoteFields(remoteExecution);
  if (missing.length) {
    const blocker = buildExecutionBoundaryBlocker({
      repoRoot,
      policyPath,
      policy,
      decision: executionDecision,
      artifactRoot,
      extra: {
        blocker: `Remote execution is enabled but incomplete. Missing remoteExecution fields: ${missing.join(', ')}.`,
        nextAction: `Fill ${relative(repoRoot, policyPath)} remoteExecution.${missing.join(', remoteExecution.')} and rerun from the control plane.`,
        requestedAgentCount,
        runId,
        remoteExecution
      }
    });
    writeJson(delegateBlockerPath, blocker);
    if (controlPlaneBlockerPath) writeJson(controlPlaneBlockerPath, blocker);
    writeJson(statusMirrorPath, { generatedAt: new Date().toISOString(), ok: false, running: false, phase: 'remote_execution_config_incomplete', requestedAgentCount, runId, transportStatusPath: relative(repoRoot, transportStatusPath), executionBoundaryPolicyPath: relative(repoRoot, policyPath), blocker });
    fs.writeFileSync(logPath, `${blocker.blocker}\n${blocker.nextAction}\n`);
    writeJson(workerStatePath, { role, status: 'blocked_by_remote_execution_config', phase: 'preflight_failed_before_remote_submission', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hostRole: executionDecision?.hostRole || null, requestedAgentCount, runId, transportStatusPath: relative(repoRoot, transportStatusPath), executionBoundaryPolicyPath: relative(repoRoot, policyPath), note: blocker.blocker });
    return { ok: false, statusCode: 1, statusMirror: { blocker } };
  }

  const remoteRunsRoot = remoteExecution.runsRoot || path.join(remoteExecution.workdir, 'mailchimp-runs');
  const effectiveRunId = runId || `manual-${Date.now()}`;
  const remoteArtifactRoot = remoteExecution.sharedArtifactRoot
    ? path.join(remoteExecution.sharedArtifactRoot, effectiveRunId)
    : path.join(remoteRunsRoot, effectiveRunId, 'artifacts', 'implementation_runs', effectiveRunId);
  const remoteLaunchScript = remoteExecution.launchScript || 'mailchimp-clone/scripts/full-audit-campaign-remote-runner.mjs';
  const startedAt = new Date().toISOString();
  const pollIntervalMs = Number(remoteExecution.statusPollMs || 15_000);
  const heartbeatMaxAgeMs = Number(remoteExecution.heartbeatMaxAgeMs || Math.max(120_000, pollIntervalMs * 4));
  const startupGraceMs = Number(remoteExecution.startupGraceMs || Math.max(60_000, pollIntervalMs * 4));
  const maxMonitorMs = Number(remoteExecution.maxMonitorMs || 0);

  const syncSummary = syncRemoteControlFiles({ repoRoot, remoteExecution });
  const detachedLaunch = buildDetachedRemoteLaunchCommand({
    remoteExecution: { ...remoteExecution, launchScript: remoteLaunchScript },
    effectiveRunId,
    remoteRunsRoot,
    remoteArtifactRoot,
    shellQuote
  });

  writeJson(workerStatePath, {
    role,
    status: 'remote_submission_running',
    phase: 'submitting_to_execution_plane',
    startedAt,
    updatedAt: startedAt,
    hostRole: executionDecision?.hostRole || null,
    requestedAgentCount,
    runId: effectiveRunId,
    remoteExecution: {
      host: remoteExecution.host,
      user: remoteExecution.user,
      port: remoteExecution.port || 22,
      workdir: remoteExecution.workdir,
      runsRoot: remoteRunsRoot,
      remoteRunRoot: detachedLaunch.remoteRunRoot,
      launchScript: remoteLaunchScript,
      remoteArtifactRoot,
      launchLogPath: detachedLaunch.launchLogPath,
      launchPidPath: detachedLaunch.launchPidPath
    },
    syncedRemoteControlFiles: syncSummary,
    transportStatusPath: relative(repoRoot, transportStatusPath),
    executionBoundaryPolicyPath: relative(repoRoot, policyPath),
    note: 'Submitting Mailchimp heavy execution to the execution-plane host in detached mode.'
  });
  writeJson(statusMirrorPath, buildStartupStatusMirror({
    repoRoot,
    logPath,
    transportStatusPath,
    policyPath,
    requestedAgentCount,
    effectiveRunId,
    remoteExecution,
    remoteRunsRoot,
    remoteRunRoot: detachedLaunch.remoteRunRoot,
    remoteLaunchScript,
    remoteArtifactRoot,
    syncSummary,
    launchPid: null
  }));

  if (emitSessionEvent) emitSessionEvent({
    artifactRoot,
    event: 'session.started',
    summary: 'Submitted the Mailchimp heavy worker campaign to the execution-plane host in detached mode.',
    threadContext,
    repoPath: repoRoot,
    extra: {
      transportStatus,
      requestedAgentCount,
      runId: effectiveRunId,
      syncedRemoteControlFiles: syncSummary,
      remoteExecution: {
        host: remoteExecution.host,
        user: remoteExecution.user,
        port: remoteExecution.port || 22,
        workdir: remoteExecution.workdir,
        runsRoot: remoteRunsRoot,
        remoteRunRoot: detachedLaunch.remoteRunRoot,
        launchScript: remoteLaunchScript,
        remoteArtifactRoot,
        launchLogPath: detachedLaunch.launchLogPath,
        launchPidPath: detachedLaunch.launchPidPath
      }
    }
  });

  const launchResult = runSsh(remoteExecution, detachedLaunch.command, { timeoutMs: 60_000, maxBuffer: 1024 * 1024 * 40 });
  const launchPid = parseLaunchPid(launchResult);
  fs.appendFileSync(logPath, `${launchResult.stdout || ''}${launchResult.stderr || ''}${launchResult.error ? `\n[spawn-error] ${String(launchResult.error.message || launchResult.error)}` : ''}`);

  if (launchResult.status !== 0 || launchResult.error || !launchPid) {
    const blocker = buildRemoteWatchdogBlocker({
      runId: effectiveRunId,
      remoteArtifactRoot,
      reason: 'Detached remote launch failed before monitoring could begin.',
      nextAction: `Inspect ${detachedLaunch.launchLogPath} and the control-plane remote submission log, then retry the execution-plane launch.`,
      launchPid: launchPid || null
    });
    writeJson(delegateBlockerPath, blocker);
    if (controlPlaneBlockerPath) writeJson(controlPlaneBlockerPath, blocker);
    const failedMirror = {
      generatedAt: new Date().toISOString(),
      ok: false,
      running: false,
      phase: 'remote_execution_launch_failed',
      requestedAgentCount,
      runId: effectiveRunId,
      launchPid: launchPid || null,
      exitCode: launchResult.status,
      signal: launchResult.signal,
      spawnError: launchResult.error ? String(launchResult.error.message || launchResult.error) : null,
      logPath: relative(repoRoot, logPath),
      executionBoundaryPolicyPath: relative(repoRoot, policyPath),
      transportStatusPath: relative(repoRoot, transportStatusPath),
      remoteExecution: {
        host: remoteExecution.host,
        user: remoteExecution.user,
        port: remoteExecution.port || 22,
        workdir: remoteExecution.workdir,
        runsRoot: remoteRunsRoot,
        remoteRunRoot: detachedLaunch.remoteRunRoot,
        launchScript: remoteLaunchScript,
        remoteArtifactRoot,
        launchLogPath: detachedLaunch.launchLogPath,
        launchPidPath: detachedLaunch.launchPidPath
      },
      syncedRemoteControlFiles: syncSummary,
      blocker
    };
    writeJson(statusMirrorPath, failedMirror);
    writeJson(workerStatePath, {
      role,
      status: 'remote_execution_launch_failed',
      phase: 'remote_execution_launch_failed',
      startedAt,
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ok: false,
      exitCode: launchResult.status,
      signal: launchResult.signal,
      spawnError: launchResult.error ? String(launchResult.error.message || launchResult.error) : null,
      requestedAgentCount,
      runId: effectiveRunId,
      launchPid: launchPid || null,
      transportStatusPath: relative(repoRoot, transportStatusPath),
      executionBoundaryPolicyPath: relative(repoRoot, policyPath),
      note: blocker.blocker
    });
    return { ok: false, statusCode: 1, statusMirror: failedMirror };
  }

  let latestMirror = { mirrored: {}, remoteLauncherPid: String(launchPid) };
  let pollCount = 0;
  let remoteWatchdog = null;
  const monitorStartedAtMs = Date.now();

  while (true) {
    latestMirror = mirrorRemoteArtifacts({
      repoRoot,
      remoteExecution,
      remoteArtifactRoot,
      remoteRunRoot: detachedLaunch.remoteRunRoot,
      delegateArtifactRoot,
      delegateCompletionSummaryPath,
      delegateProgramStatePath,
      delegateBlockerPath,
      controlPlaneBlockerPath
    });
    pollCount += 1;
    const remoteStatus = latestMirror.remoteExecutionStatus || null;
    const mirroredTerminal = deriveMirroredTerminalState({ effectiveRunId, startedAt, mirror: latestMirror });
    const remoteHeartbeatAt = remoteStatus?.heartbeatAt || remoteStatus?.generatedAt || null;
    const heartbeatAgeMs = remoteHeartbeatAt ? Math.max(0, Date.now() - Date.parse(remoteHeartbeatAt)) : null;
    const startupAgeMs = Date.now() - monitorStartedAtMs;

    if (!mirroredTerminal.terminal && !remoteStatus && startupAgeMs > startupGraceMs) {
      const launcherAlive = checkRemotePidAlive(remoteExecution, launchPid);
      remoteWatchdog = buildRemoteWatchdogBlocker({
        runId: effectiveRunId,
        remoteArtifactRoot,
        reason: 'Remote execution never produced a status file within the startup grace period.',
        nextAction: `Inspect ${detachedLaunch.launchLogPath} on the execution plane, confirm the remote runner started, and fix launch/runtime startup before rerunning.`,
        launchPid,
        startupAgeSec: Math.round(startupAgeMs / 1000),
        launcherAlive
      });
    } else if (!mirroredTerminal.terminal && remoteStatus?.running && heartbeatAgeMs != null && heartbeatAgeMs > heartbeatMaxAgeMs) {
      const launcherAlive = checkRemotePidAlive(remoteExecution, launchPid);
      const remoteRunnerPid = remoteStatus?.runnerPid || remoteStatus?.childPid || null;
      const runnerAlive = checkRemotePidAlive(remoteExecution, remoteRunnerPid);
      remoteWatchdog = buildRemoteWatchdogBlocker({
        runId: effectiveRunId,
        remoteArtifactRoot,
        reason: 'Remote execution heartbeat went stale on the execution plane.',
        nextAction: `Inspect ${relative(repoRoot, path.join(delegateArtifactRoot, 'remote_execution.log'))} and the remote runner process, then repair the event-loop stall or hung execution before retrying.`,
        launchPid,
        remoteRunnerPid,
        heartbeatAgeSec: Math.round(heartbeatAgeMs / 1000),
        currentTestHint: remoteStatus?.heartbeat?.currentTestHint || null,
        launcherAlive,
        runnerAlive
      });
    } else if (!mirroredTerminal.terminal && maxMonitorMs > 0 && Date.now() - monitorStartedAtMs > maxMonitorMs) {
      remoteWatchdog = buildRemoteWatchdogBlocker({
        runId: effectiveRunId,
        remoteArtifactRoot,
        reason: 'Remote execution exceeded the configured maximum monitor duration.',
        nextAction: 'Review whether the campaign is making legitimate progress or needs a larger time budget, then relaunch with an updated maxMonitorMs if appropriate.',
        launchPid,
        startupAgeSec: Math.round((Date.now() - monitorStartedAtMs) / 1000),
        currentTestHint: remoteStatus?.heartbeat?.currentTestHint || null
      });
    }

    const runningMirror = buildRunningStatusMirror({
      repoRoot,
      logPath,
      transportStatusPath,
      policyPath,
      requestedAgentCount,
      effectiveRunId,
      remoteExecution,
      remoteRunsRoot,
      remoteRunRoot: detachedLaunch.remoteRunRoot,
      remoteLaunchScript,
      remoteArtifactRoot,
      syncSummary,
      pollCount,
      lastPolledAt: new Date().toISOString(),
      launchPid,
      mirror: latestMirror,
      remoteWatchdog
    });
    writeJson(statusMirrorPath, runningMirror);
    writeJson(workerStatePath, {
      role,
      status: remoteWatchdog ? 'remote_execution_watchdog_fired' : 'remote_execution_running',
      phase: remoteWatchdog ? 'remote_execution_watchdog_fired' : 'remote_execution_monitoring',
      startedAt,
      updatedAt: new Date().toISOString(),
      hostRole: executionDecision?.hostRole || null,
      requestedAgentCount,
      runId: effectiveRunId,
      launchPid,
      pollCount,
      remoteExecution: {
        host: remoteExecution.host,
        user: remoteExecution.user,
        port: remoteExecution.port || 22,
        workdir: remoteExecution.workdir,
        runsRoot: remoteRunsRoot,
        remoteRunRoot: detachedLaunch.remoteRunRoot,
        launchScript: remoteLaunchScript,
        remoteArtifactRoot,
        launchLogPath: detachedLaunch.launchLogPath,
        launchPidPath: detachedLaunch.launchPidPath
      },
      syncedRemoteControlFiles: syncSummary,
      mirrored: latestMirror.mirrored,
      remoteExecutionStatus: latestMirror.remoteExecutionStatus,
      remoteExecutionTerminal: latestMirror.remoteExecutionTerminal,
      remoteCanonicalSummary: latestMirror.remoteCanonicalSummary,
      remoteNotifierEligibility: latestMirror.remoteNotifierEligibility,
      remoteWatchdog,
      transportStatusPath: relative(repoRoot, transportStatusPath),
      executionBoundaryPolicyPath: relative(repoRoot, policyPath),
      note: remoteWatchdog ? remoteWatchdog.blocker : 'Detached execution-plane Mailchimp worker is still running; control-plane mirrors and heartbeats are live.'
    });

    let monitorDecision = shouldFinalizeRemoteExecutionMonitor({
      remoteExecutionStatus: remoteStatus,
      mirroredTerminal,
      remoteWatchdog
    });

    if (!remoteWatchdog && monitorDecision.finalize && !mirroredTerminal.terminal) {
      const launcherAlive = checkRemotePidAlive(remoteExecution, launchPid);
      const remoteRunnerPid = remoteStatus?.runnerPid || remoteStatus?.childPid || null;
      const runnerAlive = checkRemotePidAlive(remoteExecution, remoteRunnerPid);
      monitorDecision = shouldFinalizeRemoteExecutionMonitor({
        remoteExecutionStatus: remoteStatus,
        mirroredTerminal,
        remoteWatchdog,
        launcherAlive,
        runnerAlive
      });
    }

    if (remoteWatchdog) {
      writeJson(delegateBlockerPath, remoteWatchdog);
      if (controlPlaneBlockerPath) writeJson(controlPlaneBlockerPath, remoteWatchdog);
      break;
    }
    if (monitorDecision.finalize) {
      break;
    }
    await sleep(pollIntervalMs);
  }

  if (!remoteWatchdog && latestMirror.remoteCanonicalSummary && (!latestMirror.remoteCompletionSummary || !latestMirror.remoteProgramState)) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await sleep(500);
      latestMirror = mirrorRemoteArtifacts({
        repoRoot,
        remoteExecution,
        remoteArtifactRoot,
        remoteRunRoot: detachedLaunch.remoteRunRoot,
        delegateArtifactRoot,
        delegateCompletionSummaryPath,
        delegateProgramStatePath,
        delegateBlockerPath,
        controlPlaneBlockerPath
      });
      if (latestMirror.remoteCompletionSummary && latestMirror.remoteProgramState) break;
    }
  }

  const finalRemoteStatus = latestMirror.remoteExecutionStatus || null;
  const finalMirroredTerminal = deriveMirroredTerminalState({ effectiveRunId, startedAt, mirror: latestMirror });
  const remoteBlocker = finalMirroredTerminal.blocker || latestMirror.remoteBlocker || remoteWatchdog || null;
  const blocked = !remoteWatchdog && (finalMirroredTerminal.blocked || Boolean(remoteBlocker));
  const ok = !remoteWatchdog && (finalMirroredTerminal.success || (finalRemoteStatus?.ok === true && !remoteBlocker));
  const terminalPhase = ok
    ? 'remote_execution_finished'
    : remoteWatchdog
      ? 'remote_execution_watchdog_fired'
      : blocked
        ? 'remote_execution_completed_with_blocker'
        : 'remote_execution_failed';
  const statusMirror = {
    generatedAt: new Date().toISOString(),
    ok,
    running: false,
    phase: terminalPhase,
    requestedAgentCount,
    runId: effectiveRunId,
    launchPid,
    pollCount,
    logPath: relative(repoRoot, logPath),
    transportStatusPath: relative(repoRoot, transportStatusPath),
    executionBoundaryPolicyPath: relative(repoRoot, policyPath),
    remoteExecution: {
      host: remoteExecution.host,
      user: remoteExecution.user,
      port: remoteExecution.port || 22,
      workdir: remoteExecution.workdir,
      runsRoot: remoteRunsRoot,
      remoteRunRoot: detachedLaunch.remoteRunRoot,
      launchScript: remoteLaunchScript,
      remoteArtifactRoot,
      launchLogPath: detachedLaunch.launchLogPath,
      launchPidPath: detachedLaunch.launchPidPath
    },
    syncedRemoteControlFiles: syncSummary,
    mirrored: latestMirror.mirrored,
    remoteExecutionStatus: finalRemoteStatus,
    remoteExecutionTerminal: latestMirror.remoteExecutionTerminal,
    remoteCompletionSummary: latestMirror.remoteCompletionSummary,
    remoteProgramState: latestMirror.remoteProgramState,
    remoteBlocker,
    remoteCanonicalSummary: latestMirror.remoteCanonicalSummary,
    remoteNotifierEligibility: latestMirror.remoteNotifierEligibility,
    remoteBaselineOverlay: latestMirror.remoteBaselineOverlay,
    remoteDependencyLinks: latestMirror.remoteDependencyLinks,
    remoteLauncherPid: latestMirror.remoteLauncherPid,
    remoteWatchdog
  };
  writeJson(statusMirrorPath, statusMirror);
  writeJson(workerStatePath, {
    role,
    status: terminalPhase,
    phase: ok || blocked ? 'awaiting_supervisor_reconcile' : remoteWatchdog ? 'remote_execution_watchdog_fired' : 'remote_execution_failed',
    startedAt,
    updatedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    ok,
    requestedAgentCount,
    runId: effectiveRunId,
    launchPid,
    pollCount,
    remoteExecution: {
      host: remoteExecution.host,
      user: remoteExecution.user,
      port: remoteExecution.port || 22,
      workdir: remoteExecution.workdir,
      runsRoot: remoteRunsRoot,
      remoteRunRoot: detachedLaunch.remoteRunRoot,
      launchScript: remoteLaunchScript,
      remoteArtifactRoot,
      launchLogPath: detachedLaunch.launchLogPath,
      launchPidPath: detachedLaunch.launchPidPath
    },
    syncedRemoteControlFiles: syncSummary,
    mirrored: latestMirror.mirrored,
    remoteExecutionStatus: latestMirror.remoteExecutionStatus,
    remoteExecutionTerminal: latestMirror.remoteExecutionTerminal,
    remoteCanonicalSummary: latestMirror.remoteCanonicalSummary,
    remoteNotifierEligibility: latestMirror.remoteNotifierEligibility,
    remoteWatchdog,
    transportStatusPath: relative(repoRoot, transportStatusPath),
    executionBoundaryPolicyPath: relative(repoRoot, policyPath),
    note: ok
      ? 'Detached remote execution finished on the execution plane; supervisor should reconcile mirrored artifacts.'
      : remoteWatchdog
        ? remoteWatchdog.blocker
        : blocked
          ? 'Detached remote execution finished with a mirrored blocker; supervisor should reconcile blocker artifacts instead of treating the transport as failed.'
          : 'Detached remote execution failed before producing a reconciled blocker or green completion state; inspect mirrored artifacts and remote logs.'
  });

  if (emitSessionEvent) emitSessionEvent({
    artifactRoot,
    event: ok ? 'session.finished' : 'session.failed',
    summary: ok
      ? 'Detached execution-plane Mailchimp worker run finished and mirrored artifacts back to the control plane.'
      : remoteWatchdog
        ? 'Detached execution-plane Mailchimp worker hit a watchdog failure.'
        : blocked
          ? 'Detached execution-plane Mailchimp worker finished and returned a blocker for supervisor reconciliation.'
          : 'Detached execution-plane Mailchimp worker failed before it could hand back a reconciled blocker or success state.',
    threadContext,
    repoPath: repoRoot,
    extra: {
      requestedAgentCount,
      runId: effectiveRunId,
      launchPid,
      syncedRemoteControlFiles: syncSummary,
      mirrored: latestMirror.mirrored,
      remoteExecutionStatus: latestMirror.remoteExecutionStatus,
      remoteExecutionTerminal: latestMirror.remoteExecutionTerminal,
      remoteCompletion: latestMirror.remoteCompletionSummary,
      remoteProgram: latestMirror.remoteProgramState,
      remoteBlocker,
      remoteCanonicalSummary: latestMirror.remoteCanonicalSummary,
      remoteNotifierEligibility: latestMirror.remoteNotifierEligibility,
      remoteBaselineOverlay: latestMirror.remoteBaselineOverlay,
      remoteDependencyLinks: latestMirror.remoteDependencyLinks,
      remoteWatchdog
    }
  });

  return { ok, blocked, statusCode: ok ? 0 : 1, statusMirror };
}
