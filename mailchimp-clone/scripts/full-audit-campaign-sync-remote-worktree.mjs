import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildRemoteRuntimeCandidates, selectRemoteRuntimeCandidate } from './lib/full-audit-campaign-remote-contract.mjs';
import { buildProductSurfaceSyncPathspecs, parsePorcelainStatus, renderPathspecArgs } from './lib/full-audit-campaign-sync-pathspecs.mjs';
import { resolveCampaignRunBinding } from './lib/full-audit-campaign-run-binding.mjs';
import { resolveProgramEnvKeys, resolveProgramPaths } from './lib/orchestration-program-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROGRAM_ENV = resolveProgramEnvKeys();
const PROGRAM_PATHS = resolveProgramPaths(ROOT);
const POLICY_PATH = path.join(ROOT, 'execution-boundary-policy.json');
const ARTIFACT_DIR = PROGRAM_PATHS.artifactDir;
const CURRENT_RUN_PATH = PROGRAM_PATHS.currentRunPath;
const WORKER_STATUS_PATH = PROGRAM_PATHS.workerStatusPath;
const STATUS_PATH = PROGRAM_PATHS.syncStatusPath;
const LOG_PATH = path.join(ARTIFACT_DIR, 'sync_remote_worktree.log');
const SYNC_PATHSPECS = buildProductSurfaceSyncPathspecs();

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sshBaseArgs(remote = {}) {
  const args = [];
  if (remote.keyPath) args.push('-i', remote.keyPath);
  args.push('-o', `BatchMode=${remote.batchMode === false ? 'no' : 'yes'}`);
  args.push('-o', `ConnectTimeout=${Number(remote.connectTimeoutSec || 10)}`);
  args.push('-o', `StrictHostKeyChecking=${remote.strictHostKeyChecking === false ? 'no' : 'yes'}`);
  if (remote.userKnownHostsFile) args.push('-o', `UserKnownHostsFile=${remote.userKnownHostsFile}`);
  if (remote.proxyJump) args.push('-J', remote.proxyJump);
  if (remote.port) args.push('-p', String(remote.port));
  args.push(`${remote.user}@${remote.host}`);
  return args;
}

function runSsh(remote, remoteCommand, timeout = 120_000) {
  return spawnSync('ssh', [...sshBaseArgs(remote), remoteCommand], { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 * 400 });
}

function runSshBuffer(remote, remoteCommand, timeout = 240_000) {
  return spawnSync('ssh', [...sshBaseArgs(remote), remoteCommand], { timeout, maxBuffer: 1024 * 1024 * 500 });
}

function readRemoteFile(remote, filePath, timeout = 60_000) {
  const result = runSsh(remote, `python3 - <<'PY'\nfrom pathlib import Path\np = Path(${JSON.stringify(filePath)})\nif p.exists():\n    print(p.read_text())\nPY`, timeout);
  if (result.status !== 0 || result.error) return null;
  return String(result.stdout || '');
}

function cleanupRemoteDisposableWorktree(remote, remoteRepo, { enabled = true } = {}) {
  if (!enabled || !remoteRepo || !remoteRepo.includes('/mailchimp-worktree-')) return null;
  const remoteCommand = `python3 - <<'PY'\nfrom pathlib import Path\nimport shutil, subprocess\np = Path(${JSON.stringify(remoteRepo)})\nremoved = False\nif p.name.startswith('mailchimp-worktree-') and p.exists():\n    shutil.rmtree(p)\n    removed = True\nsubprocess.run(['git', '-C', ${JSON.stringify(remote.workdir ? path.join(remote.workdir, 'mailchimp-clone') : '')}, 'worktree', 'prune'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\nprint({'path': str(p), 'removed': removed})\nPY`;
  const result = runSsh(remote, remoteCommand, 240_000);
  return {
    attempted: true,
    ok: result.status === 0 && !result.error,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? String(result.error.message || result.error) : null
  };
}

function listRemoteUntrackedProductFiles(remote, remoteRepo) {
  if (!remoteRepo) return [];
  const result = runSsh(remote, `cd ${JSON.stringify(remoteRepo)} && git ls-files --others --exclude-standard -- apps packages public src`, 120_000);
  if (result.status !== 0 || result.error) return [];
  return String(result.stdout || '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

function copyRemoteUntrackedProductFiles(remote, remoteRepo, files = []) {
  if (!remoteRepo || files.length === 0) return { attempted: false, copiedFileCount: 0, ok: true };
  const remoteCommand = `cd ${JSON.stringify(remoteRepo)} && python3 - <<'PY'
import subprocess, sys
paths = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z', '--', 'apps', 'packages', 'public', 'src'])
if not paths:
    sys.exit(0)
proc = subprocess.run(['tar', '--null', '-T', '-', '-cf', '-'], input=paths, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
sys.stderr.buffer.write(proc.stderr)
sys.stdout.buffer.write(proc.stdout)
sys.exit(proc.returncode)
PY`;
  const archive = runSshBuffer(remote, remoteCommand, 300_000);
  if (archive.status !== 0 || archive.error) {
    return {
      attempted: true,
      copiedFileCount: 0,
      ok: false,
      error: archive.error ? String(archive.error.message || archive.error) : String(Buffer.from(archive.stderr || '').toString() || 'remote tar failed')
    };
  }
  if (!archive.stdout || archive.stdout.length === 0) return { attempted: true, copiedFileCount: 0, ok: true };
  const extract = spawnSync('tar', ['-xf', '-', '-C', ROOT], {
    input: archive.stdout,
    encoding: 'buffer',
    timeout: 300_000,
    maxBuffer: 1024 * 1024 * 200
  });
  return {
    attempted: true,
    copiedFileCount: files.length,
    ok: extract.status === 0 && !extract.error,
    error: extract.error ? String(extract.error.message || extract.error) : (extract.status === 0 ? null : String(Buffer.from(extract.stderr || '').toString() || 'local tar extract failed'))
  };
}

const policy = loadJson(POLICY_PATH);
const remote = policy.remoteExecution || {};
const runBinding = resolveCampaignRunBinding({
  rootDir: ROOT,
  artifactDir: ARTIFACT_DIR,
  currentRunPath: CURRENT_RUN_PATH,
  workerStatusPath: WORKER_STATUS_PATH
});
const currentRun = runBinding.currentRun || loadJson(CURRENT_RUN_PATH);
const runId = process.env[PROGRAM_ENV.runId] || runBinding.runId || currentRun?.runId || null;
if (!remote.enabled) throw new Error('remoteExecution.enabled is false');
if (!runId) throw new Error('run id missing');

const runDir = path.join(ARTIFACT_DIR, 'runs', runId);
const delegateDir = path.join(runDir, 'delegate');
ensureDir(runDir);
ensureDir(delegateDir);

const candidates = buildRemoteRuntimeCandidates({ remoteExecution: remote, runId });
const statusByPath = Object.fromEntries(
  candidates
    .map((candidate) => [candidate.statusPath, readRemoteFile(remote, candidate.statusPath)])
    .map(([statusPath, text]) => [statusPath, text ? JSON.parse(text) : null])
);
const resolved = selectRemoteRuntimeCandidate({ candidates, statusByPath, runId });
const remoteRepo = resolved.remoteRepo;
const remoteArtifactRoot = resolved.remoteArtifactRoot;
const pathspecArgs = renderPathspecArgs(SYNC_PATHSPECS);
const remoteStatus = remoteRepo
  ? runSsh(remote, `cd ${JSON.stringify(remoteRepo)} && git add -N -- ${pathspecArgs} >/dev/null 2>&1 || true && git status --porcelain -- ${pathspecArgs}`)
  : { status: 1, stdout: '', stderr: 'remote repo path missing', error: null };
const remoteDiff = remoteRepo
  ? runSsh(remote, `cd ${JSON.stringify(remoteRepo)} && git add -N -- ${pathspecArgs} >/dev/null 2>&1 || true && git diff --binary HEAD -- ${pathspecArgs}`, 240_000)
  : { status: 1, stdout: '', stderr: 'remote repo path missing', error: null };
const statusText = String(remoteStatus.stdout || '');
const diffText = String(remoteDiff.stdout || '');
const remoteUntrackedProductFiles = listRemoteUntrackedProductFiles(remote, remoteRepo);
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
fs.writeFileSync(LOG_PATH, `${remoteStatus.stdout || ''}${remoteStatus.stderr || ''}\n===== DIFF =====\n${remoteDiff.stdout || ''}${remoteDiff.stderr || ''}`);

const changedFiles = parsePorcelainStatus(statusText).map((entry) => ({
  status: entry.status,
  path: entry.path,
  fromPath: entry.fromPath
}));
const patchPath = path.join(runDir, 'promoted_diff.patch');
const patchManifestPath = path.join(runDir, 'patch_manifest.json');
if (diffText.trim()) fs.writeFileSync(patchPath, diffText);
let applyOk = true;
let applyError = null;
let untrackedCopy = { attempted: false, copiedFileCount: 0, ok: true };
if (!changedFiles.length && remoteUntrackedProductFiles.length === 0) {
  applyOk = false;
  applyError = 'no_product_surface_changes_to_promote';
}
if (diffText.trim()) {
  const apply = spawnSync('git', ['-C', ROOT, 'apply', '--reject', '--whitespace=nowarn', patchPath], { encoding: 'utf8', timeout: 240_000, maxBuffer: 1024 * 1024 * 400 });
  applyOk = apply.status === 0 && !apply.error;
  applyError = apply.error ? String(apply.error.message || apply.error) : (applyOk ? null : String(apply.stderr || apply.stdout || 'git apply failed'));
}
if (applyOk && remoteUntrackedProductFiles.length > 0) {
  untrackedCopy = copyRemoteUntrackedProductFiles(remote, remoteRepo, remoteUntrackedProductFiles);
  applyOk = untrackedCopy.ok;
  applyError = untrackedCopy.ok ? applyError : untrackedCopy.error;
}
writeJson(patchManifestPath, {
  generatedAt: new Date().toISOString(),
  runId,
  remoteRepo,
  remoteArtifactRoot,
  remoteResolution: resolved.resolution,
  remoteStatusPath: resolved.candidate?.statusPath || null,
  remoteRuntimeStatus: resolved.status || null,
  availableStatuses: statusByPath,
  syncPathspecs: SYNC_PATHSPECS,
  changedFiles,
  remoteUntrackedProductFileCount: remoteUntrackedProductFiles.length,
  remoteUntrackedProductFiles: remoteUntrackedProductFiles.slice(0, 500),
  untrackedCopy,
  patchPath: diffText.trim() ? path.relative(ROOT, patchPath) : null,
  applyOk,
  applyError
});

for (const [remoteFile, localName] of Object.entries({
  canonical_summary: 'canonical_summary.json',
  notifier_eligibility: 'notifier_eligibility.json',
  remote_execution_status: 'remote_execution_status.json',
  implementation_mode_status: 'implementation_mode_status.json',
  baseline_commit: 'baseline_commit.json',
  worktree_manifest: 'worktree_manifest.json',
  baseline_overlay: 'baseline_overlay.json',
  dependency_links: 'dependency_links.json',
  completion_summary: 'completion_summary.json',
  program_state: 'program_state.json',
  blocker_report: 'blocker_report.json',
  supervisor_status: 'supervisor_status.json',
  live_execution_summary: 'live_execution_summary.json',
  patch_queue_report: 'patch_queue_report.json',
  surface_matrix: 'surface_matrix.json',
  launch_checklist: 'launch_checklist.json',
  loc_accounting: 'loc_accounting.json',
  targeted_focus_credit: 'targeted_focus_credit.json',
  benchmark_progress: 'benchmark_progress.json'
})) {
  const targetPath = path.join(delegateDir, localName);
  const text = remoteArtifactRoot ? readRemoteFile(remote, path.join(remoteArtifactRoot, `${remoteFile}.json`)) : null;
  if (!text) {
    if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
    continue;
  }
  fs.writeFileSync(targetPath, text);
}

const statusPayload = {
  generatedAt: new Date().toISOString(),
  runId,
  remoteRepo,
  remoteArtifactRoot,
  remoteResolution: resolved.resolution,
  remoteStatusPath: resolved.candidate?.statusPath || null,
  remoteRuntimeStatus: resolved.status || null,
  syncPathspecs: SYNC_PATHSPECS,
  changedFileCount: changedFiles.length,
  changedFiles,
  remoteUntrackedProductFileCount: remoteUntrackedProductFiles.length,
  remoteUntrackedProductFiles: remoteUntrackedProductFiles.slice(0, 500),
  untrackedCopy,
  patchPath: diffText.trim() ? path.relative(ROOT, patchPath) : null,
  applyOk,
  applyError,
  ok: remoteStatus.status === 0 && remoteDiff.status === 0 && applyOk
};
if (statusPayload.ok) {
  statusPayload.remoteWorktreeCleanup = cleanupRemoteDisposableWorktree(remote, remoteRepo, {
    enabled: process.env.MAILCHIMP_KEEP_REMOTE_WORKTREE !== '1'
  });
}
writeJson(STATUS_PATH, statusPayload);
console.log(JSON.stringify(statusPayload, null, 2));
process.exit(statusPayload.ok ? 0 : 1);
