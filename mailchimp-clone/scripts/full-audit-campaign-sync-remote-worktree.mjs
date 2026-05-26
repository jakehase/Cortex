import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildRemoteRuntimeCandidates, selectRemoteRuntimeCandidate } from './lib/full-audit-campaign-remote-contract.mjs';
import { buildProductSurfaceSyncPathspecs, parsePorcelainStatus, renderPathspecArgs, statusRepresentsDeletion } from './lib/full-audit-campaign-sync-pathspecs.mjs';
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
const PRODUCT_SURFACE_PREFIXES = Object.freeze(['apps/', 'packages/', 'public/', 'src/']);
const PRODUCT_SURFACE_EXCLUDED_PREFIXES = Object.freeze(['scripts/', 'tests/', 'docs/', 'artifacts/']);
const BANNED_PRODUCT_PROMOTION_MARKERS = Object.freeze([
  'high_density_mailchimp_product_surface',
  'mailchimpHighDensityProduct',
  'mailchimp_surface_grounding_',
  'mailchimp_product_density_',
  'ProductDensityV1',
  'ProductDensityFollowup',
  'mailchimp_persistence_operational_',
  'mailchimp_canonical_parity_surface',
  "runtimeKind: 'mailchimp_benchmark_grounding_delta'",
  'FullCloneDepthBlueprint',
  'FullCloneSwarmLeaf',
  'FullCloneStructuralLeaf',
  'FullCloneFrontierLeaf',
  'FullCloneRemediationLeaf',
  'full_clone_depth_evaluated',
  'full_clone_swarm_leaf_evaluated',
  'full_clone_structural_leaf_evaluated',
  'full_clone_frontier_leaf_evaluated',
  'full_clone_remediation_leaf_evaluated',
  'compact primary-product adoption marker',
  'remaining-work remediation product slice for strict Mailchimp clone blockers',
  '"fidelity": "full_clone"',
  '"requirements": [',
  '"remediationContracts": ['
]);

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

function runGit(args, options = {}) {
  return spawnSync('git', args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 * 400, ...options });
}

function localGitTopLevel() {
  const result = runGit(['-C', ROOT, 'rev-parse', '--show-toplevel']);
  return result.status === 0 && !result.error ? String(result.stdout || '').trim() : ROOT;
}

function localApplyDirectory(gitTopLevel) {
  const relativeRoot = path.relative(gitTopLevel || ROOT, ROOT).replace(/\\/g, '/');
  return relativeRoot && relativeRoot !== '.' ? relativeRoot : null;
}

function fileSha256(filePath) {
  try {
    return fs.existsSync(filePath) ? crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') : null;
  } catch {
    return null;
  }
}

function isProductSurfacePath(filePath) {
  const normalized = String(filePath || '').replace(/^\.\//, '').replace(/\\/g, '/');
  return PRODUCT_SURFACE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    && !PRODUCT_SURFACE_EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function buildCanonicalLandingEvidence({ changedFiles = [], beforeHashes = new Map(), applyOk = false, applyOutput = '', gitTopLevel = ROOT, applyDirectory = null } = {}) {
  const productFiles = Array.from(new Set(changedFiles.map((entry) => entry.path).filter(isProductSurfacePath)));
  const files = productFiles.map((filePath) => {
    const localPath = path.join(ROOT, filePath);
    const beforeHash = beforeHashes.get(filePath) || null;
    const afterHash = fileSha256(localPath);
    return {
      path: filePath,
      beforeHash,
      afterHash,
      existsAfter: Boolean(afterHash),
      changedInCanonicalCheckout: beforeHash !== afterHash,
      alreadyMatchedBeforeSync: Boolean(beforeHash && afterHash && beforeHash === afterHash)
    };
  });
  const newlyLandedProductFiles = files.filter((entry) => entry.changedInCanonicalCheckout);
  const alreadyMatchedProductFiles = files.filter((entry) => entry.alreadyMatchedBeforeSync);
  const canonicalSynchronizedProductFiles = files.filter((entry) => entry.changedInCanonicalCheckout || entry.alreadyMatchedBeforeSync);
  const skippedPatchOutput = /Skipped patch/i.test(String(applyOutput || ''));
  return {
    ok: Boolean(applyOk) && !skippedPatchOutput && canonicalSynchronizedProductFiles.length > 0,
    gitTopLevel,
    applyDirectory,
    skippedPatchOutput,
    productFileCount: files.length,
    newlyLandedProductFileCount: newlyLandedProductFiles.length,
    alreadyMatchedProductFileCount: alreadyMatchedProductFiles.length,
    canonicalSynchronizedProductFileCount: canonicalSynchronizedProductFiles.length,
    files
  };
}

function runSshBuffer(remote, remoteCommand, timeout = 240_000) {
  return spawnSync('ssh', [...sshBaseArgs(remote), remoteCommand], { timeout, maxBuffer: 1024 * 1024 * 500 });
}

function readRemoteFile(remote, filePath, timeout = 60_000) {
  const result = runSsh(remote, `python3 - <<'PY'\nfrom pathlib import Path\np = Path(${JSON.stringify(filePath)})\nif p.exists():\n    print(p.read_text())\nPY`, timeout);
  if (result.status !== 0 || result.error) return null;
  return String(result.stdout || '');
}

function readRemoteJson(remote, filePath, fallback = null) {
  const text = readRemoteFile(remote, filePath);
  if (!text) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

function numericArtifactValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function artifactFileCount(value) {
  if (Array.isArray(value)) return value.length;
  return numericArtifactValue(value, 0);
}

function buildPromotionEligibility(remote, remoteArtifactRoot) {
  if (!remoteArtifactRoot) {
    return {
      ok: false,
      reason: 'missing_remote_artifact_root',
      selectedTierMergedPatchCount: 0,
      currentProductDelta: null
    };
  }
  const mergeReport = readRemoteJson(remote, path.join(remoteArtifactRoot, 'merge', 'merge_report.json'), null);
  const liveExecutionSummary = readRemoteJson(remote, path.join(remoteArtifactRoot, 'live_execution_summary.json'), null);
  const locAccounting = readRemoteJson(remote, path.join(remoteArtifactRoot, 'loc_accounting.json'), null);
  const benchmarkProgress = readRemoteJson(remote, path.join(remoteArtifactRoot, 'benchmark_progress.json'), null);
  const remoteExecutionStatus = readRemoteJson(remote, path.join(remoteArtifactRoot, 'remote_execution_status.json'), null);
  const observed = benchmarkProgress?.observed || {};
  const remoteIterationsHadLiveWork = Array.isArray(remoteExecutionStatus?.iterations)
    && remoteExecutionStatus.iterations.some((entry) => entry?.selectedTierHadLiveWork === true);
  const benchmarkProgressHadLiveWork = numericArtifactValue(observed.distinctAgentIds, 0) > 0
    || numericArtifactValue(observed.mergedPatchCount, 0) > 0
    || numericArtifactValue(observed.verifiedMergedPatchCount, 0) > 0;
  const selectedTierHadLiveWork = remoteIterationsHadLiveWork || benchmarkProgressHadLiveWork;
  const benchmarkMergedPatchCount = selectedTierHadLiveWork
    ? Math.max(
        numericArtifactValue(observed.mergedPatchCount, 0),
        numericArtifactValue(observed.verifiedMergedPatchCount, 0)
      )
    : 0;
  const benchmarkProductChangedLines = selectedTierHadLiveWork
    ? numericArtifactValue(observed.productDiffChangedLines, 0)
    : 0;
  const benchmarkProductFileCount = selectedTierHadLiveWork
    ? artifactFileCount(observed.productDiffFiles)
    : 0;
  const selectedTierMergedPatchCount = Math.max(
    numericArtifactValue(mergeReport?.mergedPatchCount, 0),
    numericArtifactValue(liveExecutionSummary?.metrics?.mergedPatchCount, 0),
    benchmarkMergedPatchCount
  );
  const currentProductDelta = locAccounting?.incremental?.counts?.productCode || null;
  const locProductChangedLines = numericArtifactValue(currentProductDelta?.added, 0) + numericArtifactValue(currentProductDelta?.deleted, 0);
  const locProductFileCount = numericArtifactValue(currentProductDelta?.files, 0);
  const currentProductChangedLines = Math.max(locProductChangedLines, benchmarkProductChangedLines);
  const currentProductFileCount = Math.max(locProductFileCount, benchmarkProductFileCount);
  const allowZeroMergePromotion = process.env.MAILCHIMP_SYNC_ALLOW_ZERO_MERGE_PRODUCT_PROMOTION === '1';
  const ok = allowZeroMergePromotion || (selectedTierMergedPatchCount > 0 && currentProductChangedLines > 0 && currentProductFileCount > 0);
  return {
    ok,
    reason: ok ? 'selected_tier_admitted_product_delta_present' : 'no_selected_tier_admitted_product_delta',
    allowZeroMergePromotion,
    selectedTierHadLiveWork,
    selectedTierMergedPatchCount,
    mergeReportMergedPatchCount: numericArtifactValue(mergeReport?.mergedPatchCount, 0),
    liveExecutionMergedPatchCount: numericArtifactValue(liveExecutionSummary?.metrics?.mergedPatchCount, 0),
    benchmarkProgressMergedPatchCount: benchmarkMergedPatchCount,
    currentProductDelta,
    currentProductChangedLines,
    currentProductFileCount,
    locAccountingIncrementalOk: locAccounting?.incremental?.ok === true,
    benchmarkProgressFallbackUsed: benchmarkMergedPatchCount > 0 || benchmarkProductChangedLines > 0 || benchmarkProductFileCount > 0,
    benchmarkProductChangedLines,
    benchmarkProductFileCount
  };
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

function copyRemoteProductFiles(remote, remoteRepo, files = []) {
  const productFiles = Array.from(new Set(files.filter(isProductSurfacePath)));
  if (!remoteRepo || productFiles.length === 0) return { attempted: false, copiedFileCount: 0, ok: true };
  const maxFilesPerBatch = Number(process.env.MAILCHIMP_SYNC_REMOTE_COPY_BATCH_SIZE || 100);
  if (productFiles.length > maxFilesPerBatch) {
    let copiedFileCount = 0;
    for (let index = 0; index < productFiles.length; index += maxFilesPerBatch) {
      const batch = productFiles.slice(index, index + maxFilesPerBatch);
      const result = copyRemoteProductFiles(remote, remoteRepo, batch);
      copiedFileCount += Number(result.copiedFileCount || 0);
      if (!result.ok) {
        return {
          attempted: true,
          copiedFileCount,
          ok: false,
          error: result.error || `remote product copy batch ${Math.floor(index / maxFilesPerBatch) + 1} failed`
        };
      }
    }
    return { attempted: true, copiedFileCount, ok: true, error: null };
  }
  const remoteCommand = `cd ${JSON.stringify(remoteRepo)} && python3 - <<'PY'
from pathlib import Path
import json, sys, tarfile
paths = json.loads(${JSON.stringify(JSON.stringify(productFiles))})
banned_markers = json.loads(${JSON.stringify(JSON.stringify(BANNED_PRODUCT_PROMOTION_MARKERS))})
contaminated = []
for raw in paths:
    p = Path(raw)
    if not p.is_file():
        continue
    text = p.read_text(errors='ignore')
    matched = [marker for marker in banned_markers if marker in text]
    if matched:
        contaminated.append({'path': raw, 'markers': matched})
if contaminated:
    print(json.dumps({'error': 'banned_product_promotion_markers', 'contaminated': contaminated}, indent=2), file=sys.stderr)
    sys.exit(42)
with tarfile.open(fileobj=sys.stdout.buffer, mode='w|') as tar:
    for raw in paths:
        p = Path(raw)
        if p.is_file():
            tar.add(str(p), arcname=str(p))
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
    copiedFileCount: productFiles.length,
    ok: extract.status === 0 && !extract.error,
    error: extract.error ? String(extract.error.message || extract.error) : (extract.status === 0 ? null : String(Buffer.from(extract.stderr || '').toString() || 'local tar extract failed'))
  };
}

function promoteRemoteProductSurfaceFiles(remote, remoteRepo, changedFiles = [], remoteUntrackedProductFiles = []) {
  const changedProductFiles = changedFiles.filter((entry) => isProductSurfacePath(entry?.path));
  const deletedFiles = changedProductFiles
    .filter((entry) => statusRepresentsDeletion(entry.status))
    .map((entry) => entry.path);
  const copyFiles = Array.from(new Set([
    ...changedProductFiles
      .filter((entry) => !statusRepresentsDeletion(entry.status))
      .map((entry) => entry.path),
    ...remoteUntrackedProductFiles.filter(isProductSurfacePath)
  ]));
  const copy = copyRemoteProductFiles(remote, remoteRepo, copyFiles);
  if (!copy.ok) return { ...copy, deletedFileCount: 0 };
  let deletedFileCount = 0;
  for (const filePath of deletedFiles) {
    try {
      fs.rmSync(path.join(ROOT, filePath), { force: true });
      deletedFileCount += 1;
    } catch (error) {
      return {
        attempted: true,
        copiedFileCount: copy.copiedFileCount,
        deletedFileCount,
        ok: false,
        error: String(error?.message || error)
      };
    }
  }
  return {
    attempted: true,
    copiedFileCount: copy.copiedFileCount,
    deletedFileCount,
    ok: true,
    error: null
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
const promotionEligibility = buildPromotionEligibility(remote, remoteArtifactRoot);
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
let applyOutput = '';
let contentPromotion = { attempted: false, copiedFileCount: 0, deletedFileCount: 0, ok: true };
const gitTopLevel = localGitTopLevel();
const applyDirectory = localApplyDirectory(gitTopLevel);
const expectedProductPaths = Array.from(new Set([
  ...changedFiles.map((entry) => entry.path),
  ...remoteUntrackedProductFiles
].filter(isProductSurfacePath)));
const beforeHashes = new Map(expectedProductPaths
  .map((filePath) => [filePath, fileSha256(path.join(ROOT, filePath))]));
if (!changedFiles.length && remoteUntrackedProductFiles.length === 0) {
  applyOk = false;
  applyError = 'no_product_surface_changes_to_promote';
}
if ((diffText.trim() || remoteUntrackedProductFiles.length > 0) && expectedProductPaths.length > 0 && !promotionEligibility.ok) {
  applyOk = false;
  applyError = promotionEligibility.reason;
  applyOutput = `product-promotion refused: ${promotionEligibility.reason}`;
  contentPromotion = {
    attempted: false,
    copiedFileCount: 0,
    deletedFileCount: 0,
    ok: false,
    error: promotionEligibility.reason
  };
} else if (diffText.trim() || remoteUntrackedProductFiles.length > 0) {
  if (process.env.MAILCHIMP_SYNC_APPLY_PATCH === '1' && diffText.trim()) {
    const applyArgs = ['-C', gitTopLevel || ROOT, 'apply', '--reject', '--whitespace=nowarn'];
    if (applyDirectory) applyArgs.push(`--directory=${applyDirectory}`);
    applyArgs.push(patchPath);
    const apply = runGit(applyArgs, { timeout: 240_000 });
    applyOutput = `${apply.stdout || ''}${apply.stderr || ''}`;
    applyOk = apply.status === 0 && !apply.error && !/Skipped patch/i.test(applyOutput);
    applyError = apply.error
      ? String(apply.error.message || apply.error)
      : (applyOk ? null : String(applyOutput || 'git apply failed or skipped patches'));
  } else {
    contentPromotion = promoteRemoteProductSurfaceFiles(remote, remoteRepo, changedFiles, remoteUntrackedProductFiles);
    applyOutput = `content-promotion copied=${contentPromotion.copiedFileCount || 0} deleted=${contentPromotion.deletedFileCount || 0}`;
    applyOk = contentPromotion.ok;
    applyError = contentPromotion.ok ? null : contentPromotion.error;
  }
}
const canonicalLandingEvidence = buildCanonicalLandingEvidence({
  changedFiles: expectedProductPaths.map((filePath) => ({ path: filePath })),
  beforeHashes,
  applyOk,
  applyOutput,
  gitTopLevel,
  applyDirectory
});
if (!canonicalLandingEvidence.ok && applyOk) {
  applyOk = false;
  applyError = 'no_new_product_surface_changes_landed_in_canonical_checkout';
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
  promotionEligibility,
  syncPathspecs: SYNC_PATHSPECS,
  changedFiles,
  remoteUntrackedProductFileCount: remoteUntrackedProductFiles.length,
  remoteUntrackedProductFiles: remoteUntrackedProductFiles.slice(0, 500),
  contentPromotion,
  patchPath: diffText.trim() ? path.relative(ROOT, patchPath) : null,
  applyOk,
  applyError,
  canonicalLandingEvidence
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
  promotionEligibility,
  syncPathspecs: SYNC_PATHSPECS,
  changedFileCount: changedFiles.length,
  changedFiles,
  remoteUntrackedProductFileCount: remoteUntrackedProductFiles.length,
  remoteUntrackedProductFiles: remoteUntrackedProductFiles.slice(0, 500),
  contentPromotion,
  patchPath: diffText.trim() ? path.relative(ROOT, patchPath) : null,
  applyOk,
  applyError,
  canonicalLandingEvidence,
  ok: remoteStatus.status === 0 && remoteDiff.status === 0 && applyOk && canonicalLandingEvidence.ok
};
if (statusPayload.ok) {
  statusPayload.remoteWorktreeCleanup = cleanupRemoteDisposableWorktree(remote, remoteRepo, {
    enabled: process.env.MAILCHIMP_KEEP_REMOTE_WORKTREE !== '1'
  });
}
writeJson(STATUS_PATH, statusPayload);
console.log(JSON.stringify(statusPayload, null, 2));
process.exit(statusPayload.ok ? 0 : 1);
