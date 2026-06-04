import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadContract } from '../../large-project-capability-stack/packages/task-contract/index.mjs';
import { loadGraph, saveGraph, setIssueStatus, summarizeGraph } from '../../large-project-capability-stack/packages/issue-dag/index.mjs';
import { compileSurfaceMatrix, deriveSupervisorTruth, saveMatrix } from '../../large-project-capability-stack/packages/surface-matrix/index.mjs';
import { recoverCampaign, setSupervisor } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import {
  paths,
  issueDefinitions,
  surfaceDefinitions,
  readJson,
  RUNS_DIR,
  writeJson,
  extractVerifiedFocusIdsFromPatchQueue,
  extractSuspectFocusIdsFromPatchQueue,
  PRODUCT_ONLY_MODE,
  canonicalizeFocusId,
  mailchimpParityFocusIds,
  normalizeFocusIds
} from './lib/orchestrator-real-repo-clean-plan.mjs';
import { MAILCHIMP_CANONICAL_ONE_PASS_PLAN } from './lib/mailchimp-canonical-one-pass-plan-data.mjs';

function exists(filePath) {
  return fs.existsSync(filePath);
}

function resolveMatrixStatus(matrix = null) {
  return matrix?.status || matrix?.summary?.status || 'partial';
}

function tierDir(tier) {
  return path.join(RUNS_DIR, `tier-${String(tier).padStart(3, '0')}`);
}

function isProductSurfacePath(filePath) {
  return typeof filePath === 'string'
    && (filePath.startsWith('packages/') || filePath.startsWith('apps/') || filePath.startsWith('tests/'));
}

function isProductCodePath(filePath) {
  return typeof filePath === 'string'
    && (filePath.startsWith('packages/') || filePath.startsWith('apps/'));
}

function normalizeDiffPath(filePath) {
  return String(filePath || '')
    .replace(/\{[^}]* => ([^}]*)\}/g, '$1')
    .replace(/^.* => /, '')
    .trim();
}

function classifyDiffPath(filePath) {
  const normalized = normalizeDiffPath(filePath);
  if (isProductCodePath(normalized)) return 'productCode';
  if (normalized.startsWith('tests/')) return 'tests';
  if (normalized.startsWith('scripts/')) return 'scripts';
  if (normalized.startsWith('docs/')) return 'docs';
  if (normalized.startsWith('artifacts/')) return 'artifacts';
  return 'other';
}

function summarizeLocEntries(entries = [], category = null) {
  const filtered = category ? entries.filter((entry) => entry.category === category) : entries;
  return filtered.reduce((summary, entry) => {
    summary.files += 1;
    summary.added += Number.isFinite(entry.added) ? entry.added : 0;
    summary.deleted += Number.isFinite(entry.deleted) ? entry.deleted : 0;
    summary.binaryFiles += entry.binary ? 1 : 0;
    return summary;
  }, { files: 0, added: 0, deleted: 0, net: 0, binaryFiles: 0 });
}

function finalizeLocSummary(summary) {
  return {
    ...summary,
    net: summary.added - summary.deleted
  };
}


function subtractLocSummary(current = {}, baseline = {}) {
  const added = Number(current.added || 0) - Number(baseline.added || 0);
  const deleted = Number(current.deleted || 0) - Number(baseline.deleted || 0);
  return {
    files: Math.max(0, Number(current.files || 0) - Number(baseline.files || 0)),
    added,
    deleted,
    net: added - deleted,
    binaryFiles: Math.max(0, Number(current.binaryFiles || 0) - Number(baseline.binaryFiles || 0))
  };
}

function buildIncrementalLocAccounting(currentCounts = null, launchBaseline = null) {
  if (!currentCounts || !launchBaseline?.counts) {
    return {
      ok: false,
      reason: 'missing_pre_launch_loc_baseline',
      note: 'Launch-specific LOC is unknown because no pre-launch dirty-diff baseline artifact was available.'
    };
  }
  const categories = ['all', 'productCode', 'tests', 'scripts', 'docs', 'artifacts', 'other'];
  const counts = {};
  for (const category of categories) counts[category] = subtractLocSummary(currentCounts[category] || {}, launchBaseline.counts[category] || {});
  return {
    ok: true,
    baselinePath: paths.launchLocBaseline,
    baselineGeneratedAt: launchBaseline.generatedAt || null,
    baselineType: launchBaseline.baseline?.type || 'pre_launch_dirty_diff_snapshot',
    counts,
    note: 'Counts are final dirty diff minus pre-launch dirty diff, so they represent this launch increment rather than cumulative overlay LOC.'
  };
}

const PRODUCT_LOC_TRUTH_ROOTS = Object.freeze(['apps', 'packages', 'plugins']);
const LOC_TRUTH_SKIP_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.pdf', '.zip', '.gz', '.tar', '.sqlite', '.db', '.map']);
const LOC_TRUTH_BLOAT_MARKERS = Object.freeze([
  'full_clone_remediation_leaf_evaluated',
  'compact primary-product adoption marker',
  'remaining-work remediation product slice for strict Mailchimp clone blockers',
  '"fidelity": "full_clone"',
  '"requirements": [',
  '"remediationContracts": ['
]);

function normalizeLocTruthLine(line) {
  return String(line || '').trim().replace(/\s+/g, ' ');
}

function countTextLines(text = '') {
  if (!text) return 0;
  const lines = String(text).split(/\r?\n/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

function isLocTruthTextPath(filePath) {
  return !LOC_TRUTH_SKIP_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function gitLines(repoRoot, args = [], { timeout = 120000, maxBuffer = 16 * 1024 * 1024 } = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    timeout,
    maxBuffer
  });
  if (result.status !== 0 || result.error) return [];
  return String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function computeProductLocTruth(repoRoot) {
  const trackedFiles = gitLines(repoRoot, ['ls-files', '--', ...PRODUCT_LOC_TRUTH_ROOTS]);
  const untrackedFiles = gitLines(repoRoot, ['ls-files', '--others', '--exclude-standard', '--', ...PRODUCT_LOC_TRUTH_ROOTS]);
  const untrackedSet = new Set(untrackedFiles);
  const allFiles = Array.from(new Set([...trackedFiles, ...untrackedFiles])).sort();
  const fileRecords = [];
  let baselineProductLOC = 0;
  let baselineTrackedFiles = 0;
  for (const filePath of trackedFiles) {
    if (!isLocTruthTextPath(filePath)) continue;
    const show = spawnSync('git', ['show', `HEAD:${filePath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024
    });
    if (show.status !== 0 || show.error || String(show.stdout || '').includes('\u0000')) continue;
    baselineProductLOC += countTextLines(show.stdout || '');
    baselineTrackedFiles += 1;
  }
  const allNormalizedLines = [];
  for (const filePath of allFiles) {
    if (!isLocTruthTextPath(filePath)) continue;
    const absPath = path.join(repoRoot, filePath);
    try {
      const stat = fs.statSync(absPath);
      if (!stat.isFile()) continue;
      const text = fs.readFileSync(absPath, 'utf8');
      if (text.includes('\u0000')) continue;
      const lines = text.split(/\r?\n/);
      const normalizedLines = lines.map(normalizeLocTruthLine).filter(Boolean);
      const localCounts = normalizedLines.reduce((counts, line) => {
        counts.set(line, (counts.get(line) || 0) + 1);
        return counts;
      }, new Map());
      allNormalizedLines.push(...normalizedLines);
      fileRecords.push({
        path: filePath,
        loc: countTextLines(text),
        nonblank: normalizedLines.length,
        uniqueNormalized: localCounts.size,
        duplicateNormalizedInstances: Math.max(0, normalizedLines.length - localCounts.size),
        maxRepeat: Math.max(0, ...localCounts.values()),
        untracked: untrackedSet.has(filePath)
      });
    } catch {}
  }

  const diff = spawnSync('git', ['diff', '--unified=0', 'HEAD', '--', ...PRODUCT_LOC_TRUTH_ROOTS], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 24 * 1024 * 1024
  });
  const addedLines = [];
  if (diff.status === 0 && !diff.error) {
    for (const line of String(diff.stdout || '').split(/\r?\n/)) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const normalized = normalizeLocTruthLine(line.slice(1));
        if (normalized) addedLines.push(normalized);
      }
    }
  }
  for (const filePath of untrackedFiles) {
    if (!isLocTruthTextPath(filePath)) continue;
    try {
      for (const line of fs.readFileSync(path.join(repoRoot, filePath), 'utf8').split(/\r?\n/)) {
        const normalized = normalizeLocTruthLine(line);
        if (normalized) addedLines.push(normalized);
      }
    } catch {}
  }
  const currentCounts = allNormalizedLines.reduce((counts, line) => {
    counts.set(line, (counts.get(line) || 0) + 1);
    return counts;
  }, new Map());
  const addedCounts = addedLines.reduce((counts, line) => {
    counts.set(line, (counts.get(line) || 0) + 1);
    return counts;
  }, new Map());
  const markerCounts = {};
  for (const marker of LOC_TRUTH_BLOAT_MARKERS) markerCounts[marker] = addedLines.filter((line) => line.includes(marker)).length;
  const addedNonblankLines = addedLines.length;
  const addedUniqueNormalizedLines = addedCounts.size;
  const addedDuplicateNormalizedLineInstances = Math.max(0, addedNonblankLines - addedUniqueNormalizedLines);
  const duplicateAddedLineRatio = addedNonblankLines > 0 ? Number((addedDuplicateNormalizedLineInstances / addedNonblankLines).toFixed(4)) : 0;
  const markerLineCount = Object.values(markerCounts).reduce((sum, count) => sum + count, 0);
  const semanticBloatReasons = [];
  if (addedNonblankLines >= 500 && duplicateAddedLineRatio >= 0.55) semanticBloatReasons.push('high_duplicate_normalized_added_line_ratio');
  if (Number(markerCounts.full_clone_remediation_leaf_evaluated || 0) >= 20) semanticBloatReasons.push('repeated_remediation_marker_blocks');
  if (Number(markerCounts['"fidelity": "full_clone"'] || 0) >= 20 || Number(markerCounts['"remediationContracts": ['] || 0) >= 20) semanticBloatReasons.push('remediation_blueprint_boilerplate_concentration');
  if (markerLineCount >= 100 && markerLineCount / Math.max(1, addedNonblankLines) >= 0.03) semanticBloatReasons.push('marker_heavy_product_delta');

  return {
    generatedAt: new Date().toISOString(),
    roots: PRODUCT_LOC_TRUTH_ROOTS,
    baselineProductLOC,
    baselineTrackedFiles,
    currentProductLOC: fileRecords.reduce((sum, record) => sum + record.loc, 0),
    currentProductFiles: fileRecords.length,
    trackedProductLOC: fileRecords.filter((record) => !record.untracked).reduce((sum, record) => sum + record.loc, 0),
    trackedProductFiles: fileRecords.filter((record) => !record.untracked).length,
    untrackedProductLOC: fileRecords.filter((record) => record.untracked).reduce((sum, record) => sum + record.loc, 0),
    untrackedProductFiles: fileRecords.filter((record) => record.untracked).length,
    currentNonblankLines: allNormalizedLines.length,
    currentUniqueNormalizedLines: currentCounts.size,
    currentDuplicateNormalizedInstances: Math.max(0, allNormalizedLines.length - currentCounts.size),
    addedNonblankLinesApprox: addedNonblankLines,
    addedUniqueNormalizedLinesApprox: addedUniqueNormalizedLines,
    addedDuplicateNormalizedLineInstancesApprox: addedDuplicateNormalizedLineInstances,
    duplicateAddedLineRatio,
    markerCounts,
    markerLineCount,
    topRepeatedAddedLines: Array.from(addedCounts.entries())
      .filter(([, count]) => count >= 10)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 20)
      .map(([line, count]) => ({ line: line.slice(0, 160), count })),
    topFilesByLOC: fileRecords.sort((left, right) => right.loc - left.loc).slice(0, 25),
    semanticBloatSuspect: semanticBloatReasons.length > 0,
    semanticBloatReasons,
    note: 'Raw LOC truth separates physical line growth from meaningful architecture/parity credit. semanticBloatSuspect blocks completion credit until inspected.'
  };
}


function computeLocAccounting(repoRoot, { runForArtifacts = null, selectedTier = null, priorLocAccounting = null } = {}) {
  const diff = spawnSync('git', ['diff', '--numstat', '--find-renames=90%', 'HEAD', '--', '.'], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024
  });
  if (diff.status !== 0 || diff.error) {
    if (priorLocAccounting?.ok === true
      && priorLocAccounting?.runRoot === (runForArtifacts?.runRoot || null)
      && Number(priorLocAccounting?.selectedTier || 0) === Number(selectedTier || 0)) {
      return {
        ...priorLocAccounting,
        generatedAt: new Date().toISOString(),
        replayedAt: new Date().toISOString(),
        reusedPriorLocAccounting: true,
        unavailableRepoRoot: repoRoot,
        originalGeneratedAt: priorLocAccounting.generatedAt || null,
        note: `${priorLocAccounting.note || ''} Reused prior LOC accounting because the disposable target worktree was no longer present during supervisor replay.`.trim()
      };
    }
    return {
      generatedAt: new Date().toISOString(),
      ok: false,
      repoRoot,
      selectedTier,
      runRoot: runForArtifacts?.runRoot || null,
      error: diff.error ? String(diff.error.message || diff.error) : String(diff.stderr || diff.stdout || 'git diff --numstat failed')
    };
  }
  const entries = String(diff.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const rawPath = parts.slice(2).join('\t');
      const added = parts[0] === '-' ? null : Number(parts[0]);
      const deleted = parts[1] === '-' ? null : Number(parts[1]);
      const filePath = normalizeDiffPath(rawPath);
      return {
        path: filePath,
        rawPath,
        added,
        deleted,
        net: (Number.isFinite(added) ? added : 0) - (Number.isFinite(deleted) ? deleted : 0),
        binary: parts[0] === '-' || parts[1] === '-',
        category: classifyDiffPath(filePath)
      };
    });
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', '.'], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024
  });
  if (untracked.status === 0 && !untracked.error) {
    for (const relPath of String(untracked.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
      const absPath = path.join(repoRoot, relPath);
      try {
        const stat = fs.statSync(absPath);
        if (!stat.isFile()) continue;
        const text = fs.readFileSync(absPath, 'utf8');
        const added = text.length === 0 ? 0 : text.split(/\r?\n/).length;
        entries.push({
          path: normalizeDiffPath(relPath),
          rawPath: relPath,
          added,
          deleted: 0,
          net: added,
          binary: false,
          category: classifyDiffPath(relPath),
          untracked: true
        });
      } catch {}
    }
  }
  const all = finalizeLocSummary(summarizeLocEntries(entries));
  const productCode = finalizeLocSummary(summarizeLocEntries(entries, 'productCode'));
  const tests = finalizeLocSummary(summarizeLocEntries(entries, 'tests'));
  const scripts = finalizeLocSummary(summarizeLocEntries(entries, 'scripts'));
  const docs = finalizeLocSummary(summarizeLocEntries(entries, 'docs'));
  const artifacts = finalizeLocSummary(summarizeLocEntries(entries, 'artifacts'));
  const other = finalizeLocSummary(summarizeLocEntries(entries, 'other'));
  const counts = {
    all,
    productCode,
    tests,
    scripts,
    docs,
    artifacts,
    other
  };
  const launchBaseline = readJson(paths.launchLocBaseline, null);
  const incremental = buildIncrementalLocAccounting(counts, launchBaseline);
  const productLocTruth = computeProductLocTruth(repoRoot);
  return {
    generatedAt: new Date().toISOString(),
    ok: true,
    repoRoot,
    baseline: {
      type: 'git_head_worktree_diff',
      ref: 'HEAD',
      cumulativeDirtyOverlay: true,
      launchBaselinePath: paths.launchLocBaseline,
      launchBaselineAvailable: incremental.ok === true
    },
    selectedTier,
    runRoot: runForArtifacts?.runRoot || null,
    mergedPatchCount: Number(runForArtifacts?.patchQueue?.merged?.length || 0),
    requiredForCompletion: true,
    counts,
    incremental,
    productLocTruth,
    changedFiles: entries,
    productCodeFiles: entries.filter((entry) => entry.category === 'productCode'),
    note: incremental.ok
      ? 'counts is cumulative surviving diff against HEAD; incremental.counts is launch-specific final-minus-prelaunch LOC.'
      : 'counts is cumulative surviving diff against HEAD; launch-specific LOC is unknown without launch_loc_baseline.json.'
  };
}

function extractVerifiedFocusIdsFromResultFiles(runRoot) {
  const resultsDir = typeof runRoot === 'string' ? path.join(runRoot, 'results') : null;
  if (!resultsDir || !fs.existsSync(resultsDir)) return [];
  const focusIds = new Set();
  for (const entry of fs.readdirSync(resultsDir)) {
    if (!entry.endsWith('.json')) continue;
    const result = readJson(path.join(resultsDir, entry), null);
    if (!result?.ok) continue;
    const modifiedFiles = (result?.implementation?.modifiedFiles || []).filter(isProductSurfacePath);
    const testsOk = Array.isArray(result?.verifierResults)
      && result.verifierResults.some((candidate) => candidate?.verifier === 'tests' && candidate?.ok === true && candidate?.skipped !== true);
    if (modifiedFiles.length === 0 && !testsOk) continue;
    const shardId = canonicalizeFocusId(result?.shardId);
    if (shardId) focusIds.add(shardId);
  }
  return Array.from(focusIds);
}

function resolveFocusIdFromPatchEntry(entry = null) {
  return canonicalizeFocusId(
    entry?.shardId
    || entry?.taskId
    || entry?.focusId
    || entry?.metadata?.contextPack?.shard?.id
    || entry?.metadata?.implementation?.metadata?.rawFocusGroup
  );
}

function buildFocusArtifactPaths({ patchQueue = null, runRoot = null } = {}) {
  const artifactMap = new Map();
  const addArtifact = (focusId, artifactPath) => {
    if (!focusId || typeof artifactPath !== 'string' || !artifactPath.trim()) return;
    const current = artifactMap.get(focusId) || [];
    if (!current.includes(artifactPath)) artifactMap.set(focusId, [...current, artifactPath]);
  };

  for (const entry of Array.isArray(patchQueue?.merged) ? patchQueue.merged : []) {
    const focusId = resolveFocusIdFromPatchEntry(entry);
    if (!focusId) continue;
    addArtifact(focusId, entry?.metadata?.resultPath);
  }

  const resultsDir = typeof runRoot === 'string' ? path.join(runRoot, 'results') : null;
  if (!resultsDir || !fs.existsSync(resultsDir)) return artifactMap;
  for (const entry of fs.readdirSync(resultsDir)) {
    if (!entry.endsWith('.json')) continue;
    const artifactPath = path.join(resultsDir, entry);
    const result = readJson(artifactPath, null);
    if (!result?.ok) continue;
    const focusId = canonicalizeFocusId(result?.shardId);
    if (!focusId) continue;
    addArtifact(focusId, artifactPath);
  }
  return artifactMap;
}

function patchEntryHasSemanticBloatAuditSchema(entry = {}) {
  const stdout = String(entry?.metadata?.implementation?.stdout || '');
  return Boolean(entry?.metadata?.implementation?.metadata?.semanticBloatAudit)
    || Boolean(entry?.metadata?.semanticBloatAudit)
    || Boolean(entry?.admissionAudit?.semanticBloatAdmission?.details?.semanticBloatAudit)
    || /"semanticBloatAudit"\s*:/.test(stdout)
    || /"claimIntegrityKind"\s*:/.test(stdout);
}

function currentIterationSemanticBloatSuspect({ locAccounting = null, patchQueue = null, suspectFocusIds = [] } = {}) {
  if (Array.isArray(suspectFocusIds) && suspectFocusIds.length > 0) return true;
  if (locAccounting?.productLocTruth?.semanticBloatSuspect !== true) return false;
  const merged = Array.isArray(patchQueue?.merged) ? patchQueue.merged : [];
  if (merged.length === 0) return true;
  return !merged.every((entry) => patchEntryHasSemanticBloatAuditSchema(entry));
}

const FOCUS_TARGETED_TESTS = new Map(
  (MAILCHIMP_CANONICAL_ONE_PASS_PLAN.surfaceChecklist || []).map((surface) => [
    `focus.${String(surface.id || '').trim()}`,
    Array.isArray(surface.targetedTests)
      ? surface.targetedTests.map((entry) => String(entry || '').trim()).filter(Boolean)
      : []
  ])
);

function verifyFocusIdsByTargetedTests(focusIds, repoRoot = process.cwd()) {
  const verified = new Set();
  for (const focusId of Array.isArray(focusIds) ? focusIds : []) {
    if (typeof focusId !== 'string' || !focusId.startsWith('focus.')) continue;
    const tests = Array.from(new Set((FOCUS_TARGETED_TESTS.get(focusId) || [])
      .filter((entry) => fs.existsSync(path.join(repoRoot, entry)))));
    if (!tests.length) continue;
    const result = spawnSync(process.execPath, ['--test', ...tests], {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024
    });
    if (result.status === 0) verified.add(focusId);
  }
  return Array.from(verified);
}

function loadTierRun(tier) {
  const runRoot = tierDir(tier);
  const summary = readJson(path.join(runRoot, 'summary.json'), null);
  const supervisor = readJson(path.join(runRoot, 'supervisor.json'), null);
  const leaseState = readJson(path.join(runRoot, 'lease_state.json'), null);
  const patchQueue = readJson(path.join(runRoot, 'patch_queue.json'), null);
  const artifactBus = readJson(path.join(runRoot, 'artifact_bus.json'), null);
  const workerEvents = readJson(path.join(runRoot, 'worker_events.json'), null);
  if (!summary || !supervisor) return null;
  return { tier, runRoot, summary, supervisor, leaseState, patchQueue, artifactBus, workerEvents };
}

function discoverTierRuns() {
  if (!exists(RUNS_DIR)) return [];
  return fs.readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^tier-\d+$/.test(entry.name))
    .map((entry) => Number(entry.name.replace('tier-', '')))
    .sort((a, b) => a - b)
    .map(loadTierRun)
    .filter(Boolean);
}

function repoTestStatus(validationIndex, tier) {
  return validationIndex?.perTierRepoTests?.find((entry) => entry.tier === tier) || null;
}

function unresolvedRejectedPatches(patchQueue) {
  const mergedShardIds = new Set((patchQueue?.merged || []).map((artifact) => artifact.shardId));
  return (patchQueue?.rejected || []).filter((artifact) => artifact?.shardId && !mergedShardIds.has(artifact.shardId));
}

const REJECTED_PATCH_QUARANTINE_REPORT_PATH = path.join(path.dirname(paths.patchQueueReport), 'rejected_patch_quarantine_report.json');

function rejectedPatchStableId(artifact = {}) {
  return String(artifact?.id || artifact?.shardId || artifact?.taskId || '').trim();
}

function rejectedPatchHasNoProductDelta(artifact = {}) {
  const implementation = artifact?.metadata?.implementation || {};
  const implementationMetadata = implementation?.metadata || {};
  const modifiedFiles = Array.isArray(implementation?.modifiedFiles)
    ? implementation.modifiedFiles
    : Array.isArray(artifact?.filePaths)
      ? artifact.filePaths
      : [];
  const diffText = String(implementation?.diff || implementation?.unifiedDiff || '').trim();
  return artifact?.rejectionCategory === 'no_op'
    || artifact?.rejectionReason === 'zero_modified_files'
    || implementationMetadata?.claimIntegrityKind === 'zero_modified_files'
    || (modifiedFiles.length === 0 && diffText.length === 0);
}

function rejectedPatchHasQualityGateFailure(artifact = {}) {
  const verifierResults = Array.isArray(artifact?.metadata?.verifierResults)
    ? artifact.metadata.verifierResults
    : Array.isArray(artifact?.verifierResults)
      ? artifact.verifierResults
      : [];
  return artifact?.rejectionCategory === 'quality_gate_failed'
    || verifierResults.some((result) => result?.ok === false && result?.skipped !== true);
}

function buildRejectedPatchQuarantine({ rejected = [], provenFocusIds = new Set(), allFocusComplete = false, selectedTierHadLiveWork = false, repoRoot = process.cwd() } = {}) {
  const rejectedWithFocus = rejected.map((artifact) => ({
    artifact,
    stableId: rejectedPatchStableId(artifact),
    focusId: resolveFocusIdFromPatchEntry(artifact),
    category: String(artifact?.rejectionCategory || 'rejected'),
    rejectionReason: String(artifact?.rejectionReason || '')
  }));
  const qualityFailureFocusIds = Array.from(new Set(rejectedWithFocus
    .filter(({ artifact }) => rejectedPatchHasQualityGateFailure(artifact))
    .map(({ focusId }) => focusId)
    .filter(Boolean)));
  const finalTargetedTestVerifiedFocusIds = new Set(
    allFocusComplete && selectedTierHadLiveWork
      ? verifyFocusIdsByTargetedTests(qualityFailureFocusIds, repoRoot)
      : []
  );
  const entries = rejectedWithFocus.map(({ artifact, stableId, focusId, category, rejectionReason }) => {
    let quarantined = false;
    let quarantineReason = null;
    let blockingReason = null;
    if (!allFocusComplete) {
      blockingReason = 'focus_lanes_not_complete';
    } else if (!selectedTierHadLiveWork) {
      blockingReason = 'no_selected_tier_live_work';
    } else if (!focusId || !provenFocusIds.has(focusId)) {
      blockingReason = 'rejected_patch_focus_not_proven';
    } else if (rejectedPatchHasNoProductDelta(artifact)) {
      quarantined = true;
      quarantineReason = 'saturated_duplicate_noop_leaf_after_focus_proof';
    } else if (rejectedPatchHasQualityGateFailure(artifact) && finalTargetedTestVerifiedFocusIds.has(focusId)) {
      quarantined = true;
      quarantineReason = 'transient_verifier_failure_superseded_by_final_targeted_tests';
    } else {
      blockingReason = 'unresolved_rejected_patch_candidate';
    }
    return {
      id: stableId,
      shardId: artifact?.shardId || null,
      focusId,
      category,
      rejectionReason: rejectionReason || null,
      quarantined,
      quarantineReason,
      blockingReason
    };
  });
  const quarantinedEntries = entries.filter((entry) => entry.quarantined);
  const blockingEntries = entries.filter((entry) => !entry.quarantined);
  return {
    generatedAt: new Date().toISOString(),
    ok: blockingEntries.length === 0,
    totalRejectedCount: entries.length,
    quarantinedRejectedCount: quarantinedEntries.length,
    blockingRejectedCount: blockingEntries.length,
    quarantinedRejectedIds: quarantinedEntries.map((entry) => entry.id).filter(Boolean),
    blockingRejectedIds: blockingEntries.map((entry) => entry.id).filter(Boolean),
    finalTargetedTestVerifiedFocusIds: Array.from(finalTargetedTestVerifiedFocusIds),
    rejectionSummary: summarizeRejectedPatchCategories(rejected),
    quarantineSummary: quarantinedEntries.reduce((summary, entry) => {
      const key = entry.quarantineReason || 'quarantined';
      summary[key] ||= 0;
      summary[key] += 1;
      return summary;
    }, {}),
    blockingSummary: blockingEntries.reduce((summary, entry) => {
      const key = entry.blockingReason || 'blocking';
      summary[key] ||= 0;
      summary[key] += 1;
      return summary;
    }, {}),
    entries
  };
}

function summarizeRejectedPatchCategories(rejected = []) {
  return rejected.reduce((summary, artifact) => {
    const key = String(artifact?.rejectionCategory || 'rejected').trim() || 'rejected';
    summary[key] ||= 0;
    summary[key] += 1;
    return summary;
  }, {});
}

function makeRejectedPatchBlocker(rejected = []) {
  const categories = summarizeRejectedPatchCategories(rejected);
  if ((categories.no_op || 0) > 0 || (categories.planner_failure || 0) > 0) {
    return {
      blocker: `Planner emitted ${categories.no_op || 0} no-op and ${categories.planner_failure || 0} ungrounded patch candidate(s); no admissible parity-surface reduction was proven.`,
      nextAction: 'Repair focus-lane grounding and require real modified files plus non-skipped verifier evidence before re-running.',
      rejectionSummary: categories
    };
  }
  return {
    blocker: `${rejected.length} merged-patch candidates were rejected without resolution.`,
    nextAction: 'Resolve or quarantine the rejected patch set before re-running the parity-focus campaign.',
    rejectionSummary: categories
  };
}

function makeMergeReport(run, selectedTier) {
  const unresolvedRejected = unresolvedRejectedPatches(run.patchQueue);
  return {
    generatedAt: new Date().toISOString(),
    selectedTier,
    runRoot: run.runRoot,
    mergedPatchCount: run.patchQueue?.merged?.length || 0,
    rejectedPatchCount: unresolvedRejected.length,
    rejectedPatchCategories: summarizeRejectedPatchCategories(unresolvedRejected),
    merged: run.patchQueue?.merged || [],
    rejected: unresolvedRejected
  };
}

function makeRecoveryReport(run, selectedTier) {
  return {
    generatedAt: new Date().toISOString(),
    selectedTier,
    runRoot: run.runRoot,
    recoveryCount: run.summary?.metrics?.recoveryCount || 0,
    staleLeaseCount: run.summary?.metrics?.staleLeaseCount || 0,
    stateLossEvents: run.summary?.metrics?.stateLossEvents || 0,
    continuityFailures: run.summary?.metrics?.continuityFailures || []
  };
}

const contract = loadContract(paths.contract);
let graph = loadGraph(paths.issueGraph);
const validationIndex = readJson(paths.validationIndex, null) || { baseline: null, perTierRepoTests: [], finalSmoke: null, finalRepoTests: null };
const tierRuns = discoverTierRuns();
const attemptedTiers = tierRuns.map((run) => run.tier);
const passingRuns = tierRuns.filter((run) => {
  const repoTests = repoTestStatus(validationIndex, run.tier);
  return Boolean(repoTests?.ok) && run.supervisor?.topLevel?.status === 'green';
});
const highestPassingRun = passingRuns.at(-1) || null;
const lastAttemptedRun = tierRuns.at(-1) || null;
const runForArtifacts = highestPassingRun || lastAttemptedRun || null;
const highestPassingTier = highestPassingRun?.tier || null;
const selectedTier = runForArtifacts?.tier || null;
const selectedTierShardCount = Number(runForArtifacts?.summary?.shardCount || 0);
const selectedTierMergedShardCount = Number(runForArtifacts?.summary?.mergedShardCount || 0);
const selectedTierMergedPatchCount = Number(runForArtifacts?.summary?.metrics?.mergedPatchCount || 0);
const selectedTierObservedAgentCount = Number(runForArtifacts?.summary?.metrics?.observedAgentCount || 0);
const selectedTierPeakConcurrentWorkers = Number(runForArtifacts?.summary?.metrics?.peakConcurrentWorkers || 0);
const selectedTierSchedulerTruth = runForArtifacts?.summary?.schedulerTruth || runForArtifacts?.supervisor?.schedulerTruth || null;
const selectedTierScaleCredit = selectedTierSchedulerTruth?.scaleCredit || null;
const selectedTierMinimumObservedAgents = selectedTier
  ? Math.min(selectedTier, Math.max(2, Math.ceil(selectedTier * 0.2)))
  : 0;
const selectedTierMinimumPeakConcurrentWorkers = selectedTier
  ? Math.min(selectedTier, Math.max(2, Math.ceil(selectedTier * 0.1)))
  : 0;
const selectedTierHighScale = Number(selectedTier || 0) >= 80;
const selectedTierScaleProofOk = !selectedTier || selectedTier < 8
  ? true
  : selectedTierHighScale
    ? selectedTierScaleCredit?.eligible === true
    : (
        selectedTierObservedAgentCount >= selectedTierMinimumObservedAgents
        && selectedTierPeakConcurrentWorkers >= selectedTierMinimumPeakConcurrentWorkers
      );
const selectedTierHadLiveWork = selectedTierShardCount > 0 || selectedTierMergedShardCount > 0 || selectedTierMergedPatchCount > 0;
const provenCoordinationScaleTier = PRODUCT_ONLY_MODE && selectedTierHadLiveWork && selectedTierScaleProofOk
  ? selectedTier
  : highestPassingTier;
const launchChecklist = readJson(paths.launchChecklist, null);
const priorLocAccounting = readJson(paths.locAccounting, null);
const locAccounting = computeLocAccounting(contract.targetPath || process.cwd(), { runForArtifacts, selectedTier, priorLocAccounting });
writeJson(paths.locAccounting, locAccounting);
const launchChecklistOk = Boolean(launchChecklist?.ok) && Array.isArray(launchChecklist?.items) && launchChecklist.items.every((entry) => entry?.ok === true);
const locAccountingPresent = Boolean(locAccounting?.ok);
const productLocForAdmission = locAccounting?.incremental?.ok ? locAccounting.incremental.counts.productCode : locAccounting?.counts?.productCode;
const productCodeLineDelta = Number(productLocForAdmission?.added || 0) + Number(productLocForAdmission?.deleted || 0);
const productCodeDiffPresent = productCodeLineDelta > 0 && Number(productLocForAdmission?.files || locAccounting?.counts?.productCode?.files || 0) > 0;

if (runForArtifacts) {
  writeJson(paths.selectedTierSupervisor, runForArtifacts.supervisor);
  writeJson(paths.selectedTierSummary, runForArtifacts.summary);
  writeJson(paths.leaseState, runForArtifacts.leaseState || { generatedAt: new Date().toISOString(), history: [] });
  writeJson(paths.patchQueueReport, runForArtifacts.patchQueue || { merged: [], rejected: [] });
  writeJson(paths.artifactBus, runForArtifacts.artifactBus || { registry: [] });
  writeJson(paths.workerEvents, runForArtifacts.workerEvents || []);
  writeJson(paths.liveExecutionSummary, {
    generatedAt: new Date().toISOString(),
    qualificationMode: 'real_mailchimp_repo_live_worker_farm',
    selectedTier,
    shardCount: runForArtifacts.summary?.shardCount || 0,
    mergedShardCount: runForArtifacts.summary?.mergedShardCount || 0,
    executionMode: runForArtifacts.summary?.executionMode || 'real_mailchimp_repo_live_worker_farm',
    runRoot: runForArtifacts.runRoot,
    frontier: runForArtifacts.summary?.frontier || null,
    metrics: runForArtifacts.summary?.metrics || null
  });
  writeJson(paths.mergeReport, makeMergeReport(runForArtifacts, selectedTier));
  writeJson(paths.recoveryReport, makeRecoveryReport(runForArtifacts, selectedTier));
}

const finalSmoke = validationIndex.finalSmoke || { ok: false, command: 'node scripts/smoke-full-clone.mjs', logPath: path.join(path.dirname(paths.validationIndex), 'final_smoke.log'), durationMs: 0 };
const finalRepoTests = validationIndex.finalRepoTests || { ok: false, command: 'npm test -- --runInBand', logPath: path.join(path.dirname(paths.validationIndex), 'final_repo_tests.log'), durationMs: 0 };

const scaleQualification = {
  generatedAt: new Date().toISOString(),
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  highestPassingTier: provenCoordinationScaleTier,
  provenCoordinationScaleTier,
  realRepoLive: {
    attemptedTiers,
    highestPassingTier: provenCoordinationScaleTier,
    selectedTierScaleCredit,
    repoIntegrity: {
      baselineRepoTestsOk: Boolean(validationIndex.baseline?.ok),
      finalRepoTestsOk: Boolean(finalRepoTests.ok),
      finalSmokeOk: Boolean(finalSmoke.ok)
    },
    honestResult: provenCoordinationScaleTier ? `Highest honestly proven coordination tier on cleaned baseline: ${provenCoordinationScaleTier}` : null,
    stopReason: provenCoordinationScaleTier && (PRODUCT_ONLY_MODE || (finalSmoke.ok && finalRepoTests.ok))
      ? `Qualification completed cleanly at tier ${provenCoordinationScaleTier}.`
      : provenCoordinationScaleTier
        ? `Qualification reached tier ${provenCoordinationScaleTier}, but final smoke/final repo tests did not complete successfully.`
        : 'No clean-baseline live tier was honestly proven.'
  }
};
writeJson(paths.scaleQualification, scaleQualification);

const selectedTierSupervisor = readJson(paths.selectedTierSupervisor, null);
const selectedTierSummary = readJson(paths.selectedTierSummary, null);
const leaseState = readJson(paths.leaseState, null);
const patchQueue = readJson(paths.patchQueueReport, null);
const mergeReport = readJson(paths.mergeReport, null);
const recoveryReport = readJson(paths.recoveryReport, null);
const contextPacks = readJson(paths.contextPacks, []);
const shardPlan = readJson(paths.shardPlan, null);
const priorBlockerReport = readJson(paths.blockerReport, null);

const unresolvedRejected = unresolvedRejectedPatches(patchQueue);
const unresolvedRejectedCount = unresolvedRejected.length;
const patchQueueSuspectFocusIds = extractSuspectFocusIdsFromPatchQueue(patchQueue);
const semanticBloatCurrentIteration = currentIterationSemanticBloatSuspect({
  locAccounting,
  patchQueue,
  suspectFocusIds: patchQueueSuspectFocusIds
});
const launchChecklistBlocker = launchChecklistOk
  ? null
  : {
      blocker: 'Launch checklist is missing or failed, so the Mailchimp run cannot be credited as a valid proof run.',
      nextAction: `Inspect ${paths.launchChecklist} and repair the failed preflight item(s) before rerunning.`
    };
const locAccountingBlocker = !locAccountingPresent
  ? {
      blocker: 'Mechanical LOC accounting is missing or failed, so code-output claims for this run are not admissible.',
      nextAction: `Inspect ${paths.locAccounting} and repair the git-diff accounting step before rerunning.`
    }
  : (selectedTierHadLiveWork && !productCodeDiffPresent)
    ? {
        blocker: 'Selected live work produced no surviving product-code diff under mechanical LOC accounting.',
        nextAction: 'Produce surviving packages/ or apps/ changes before crediting the run as real code output.'
      }
    : null;
const semanticBloatBlocker = semanticBloatCurrentIteration
  ? {
      blocker: 'Deep architecture credit is contaminated by generated/remediation blueprint bulk.',
      nextAction: 'Reject high-duplicate marker/remediation product deltas and require concrete runtime integration evidence before carrying focus credit or relaunching.',
      locTruthPath: paths.locAccounting,
      semanticBloatReasons: locAccounting?.productLocTruth?.semanticBloatReasons || [],
      suspectFocusIds: patchQueueSuspectFocusIds,
      markerCounts: locAccounting?.productLocTruth?.markerCounts || {},
      duplicateAddedLineRatio: locAccounting?.productLocTruth?.duplicateAddedLineRatio || null,
      addedNonblankLinesApprox: locAccounting?.productLocTruth?.addedNonblankLinesApprox || null,
      addedUniqueNormalizedLinesApprox: locAccounting?.productLocTruth?.addedUniqueNormalizedLinesApprox || null
    }
  : null;
const scaleProofBlocker = selectedTierHadLiveWork && !selectedTierScaleProofOk
  ? {
      blocker: selectedTierHighScale && !selectedTierScaleCredit
        ? 'Selected high-scale live tier is missing scheduler scale-credit evidence, so it cannot be cited as a tiered multi-agent proof.'
        : 'Selected live tier did not prove the requested agent scale from observed worker utilization.',
      nextAction: selectedTierHighScale && selectedTierScaleCredit?.failures?.some((failure) => failure?.reason === 'insufficient_peak_concurrency')
        ? 'Increase real concurrent worker launch capacity or lower the declared tier; do not cite tier-100 until scheduler_truth.scaleCredit is eligible.'
        : 'Repair scheduling/file-area balancing and scale reporting before citing this as a tiered multi-agent proof.',
      selectedTier,
      requestedAgentCount: selectedTier,
      observedAgentCount: selectedTierObservedAgentCount,
      peakConcurrentWorkers: selectedTierPeakConcurrentWorkers,
      minimumObservedAgents: selectedTierMinimumObservedAgents,
      minimumPeakConcurrentWorkers: selectedTierMinimumPeakConcurrentWorkers,
      scaleCredit: selectedTierScaleCredit,
      schedulerTruthPath: runForArtifacts?.runRoot ? path.join(runForArtifacts.runRoot, 'scheduler_truth.json') : null
    }
  : null;

let blocker = null;
let graphSummary;
let intendedSupervisorStatus;
let intendedMatrixStatus;
let greenComplete = false;
let stageFlags;
let nextFocus = [];
let productOnlyFocusEvidence = null;

if (PRODUCT_ONLY_MODE) {
  const priorGraph = loadGraph(paths.issueGraph);
  const focusSurfaces = surfaceDefinitions();
  const focusIssues = focusSurfaces.map((surface) => {
    const issueId = Array.isArray(surface?.issueIds) && surface.issueIds.length > 0
      ? surface.issueIds[0]
      : String(surface?.focusId || '').trim();
    const priorIssue = priorGraph?.issues?.find((issue) => issue?.id === issueId) || null;
    return priorIssue || {
      id: issueId,
      title: surface?.title || surface?.label || issueId,
      lane: String(surface?.focusId || issueId).replace(/^focus\./, ''),
      deps: [],
      acceptanceCriteria: []
    };
  }).filter((issue) => typeof issue?.id === 'string' && issue.id.startsWith('focus.'));
  graph = {
    version: priorGraph?.version || 1,
    meta: priorGraph?.meta || { title: 'mailchimp-real-repo-orchestrator-qualification' },
    issues: focusIssues
  };
  const mergedFocusIds = Array.from(new Set(
    extractVerifiedFocusIdsFromPatchQueue(patchQueue)
  ));
  const rawCompletedFocusIds = normalizeFocusIds(String(process.env.MAILCHIMP_COMPLETED_FOCUS_IDS || '')
    .split(','));
  const verifiedCompletedFocusIds = normalizeFocusIds(String(process.env.MAILCHIMP_VERIFIED_COMPLETED_FOCUS_IDS || '')
    .split(','));
  const completedFocusIds = new Set(verifiedCompletedFocusIds);
  const discardedLegacyCompletedFocusIds = rawCompletedFocusIds.filter((id) => !completedFocusIds.has(id));
  const excludedFocusIds = new Set(normalizeFocusIds(String(process.env.MAILCHIMP_EXCLUDED_FOCUS_IDS || '')
    .split(',')));
  const targetedTestCandidateFocusIds = selectedTierHadLiveWork
    ? mergedFocusIds.filter((id) => !completedFocusIds.has(id))
    : [];
  const targetedTestVerifiedFocusIds = verifyFocusIdsByTargetedTests(
    targetedTestCandidateFocusIds,
    process.cwd()
  );
  const iterationFocusArtifacts = buildFocusArtifactPaths({ patchQueue, runRoot: runForArtifacts?.runRoot });
  const currentIterationProvenFocusIds = new Set([...mergedFocusIds, ...targetedTestVerifiedFocusIds]);
  const provenFocusIds = new Set([...completedFocusIds, ...currentIterationProvenFocusIds]);
  const verifiedFocusProofPresent = completedFocusIds.size > 0 || currentIterationProvenFocusIds.size > 0;
  const parityFocusIds = mailchimpParityFocusIds();
  const openUnprovenFocusIds = parityFocusIds.filter((id) => !provenFocusIds.has(id));
  nextFocus = openUnprovenFocusIds.filter((id) => !excludedFocusIds.has(id));
  const issueSatisfied = (issueId) => provenFocusIds.has(issueId) || !parityFocusIds.includes(issueId);
  const allFocusComplete = openUnprovenFocusIds.length === 0 && focusIssues.every((issue) => issueSatisfied(issue.id));
  const rejectedPatchQuarantine = buildRejectedPatchQuarantine({
    rejected: unresolvedRejected,
    provenFocusIds,
    allFocusComplete,
    selectedTierHadLiveWork,
    repoRoot: process.cwd()
  });
  if (unresolvedRejectedCount > 0) {
    writeJson(REJECTED_PATCH_QUARANTINE_REPORT_PATH, rejectedPatchQuarantine);
  } else if (exists(REJECTED_PATCH_QUARANTINE_REPORT_PATH)) {
    fs.unlinkSync(REJECTED_PATCH_QUARANTINE_REPORT_PATH);
  }
  const quarantinedRejectedIds = new Set(rejectedPatchQuarantine.quarantinedRejectedIds || []);
  const effectiveUnresolvedRejected = unresolvedRejected.filter((artifact) => !quarantinedRejectedIds.has(rejectedPatchStableId(artifact)));
  const effectiveUnresolvedRejectedCount = effectiveUnresolvedRejected.length;
  productOnlyFocusEvidence = {
    rawCompletedFocusIds,
    verifiedCompletedFocusIds,
    discardedLegacyCompletedFocusIds,
    mergedFocusIds,
    targetedTestVerifiedFocusIds,
    currentIterationProvenFocusIds: Array.from(currentIterationProvenFocusIds),
    provenFocusIds: Array.from(provenFocusIds),
    openUnprovenFocusIds,
    verifiedFocusProofPresent,
    locTruth: locAccounting?.productLocTruth || null,
    rejectedPatchQuarantine: unresolvedRejectedCount > 0 ? {
      reportPath: REJECTED_PATCH_QUARANTINE_REPORT_PATH,
      ok: rejectedPatchQuarantine.ok,
      totalRejectedCount: rejectedPatchQuarantine.totalRejectedCount,
      quarantinedRejectedCount: rejectedPatchQuarantine.quarantinedRejectedCount,
      blockingRejectedCount: rejectedPatchQuarantine.blockingRejectedCount,
      finalTargetedTestVerifiedFocusIds: rejectedPatchQuarantine.finalTargetedTestVerifiedFocusIds,
      quarantineSummary: rejectedPatchQuarantine.quarantineSummary,
      blockingSummary: rejectedPatchQuarantine.blockingSummary
    } : null,
    suspectCredit: semanticBloatBlocker ? {
      reason: 'semantic_bloat_product_delta',
      affectedCurrentIterationFocusIds: Array.from(currentIterationProvenFocusIds),
      note: 'These focus ids are not safe to carry forward until the bloat/admission audit is clean.'
    } : null
  };

  for (const issue of focusIssues) {
    const issueComplete = issueSatisfied(issue.id);
    const issueArtifacts = issueComplete
      ? Array.from(new Set([
          ...(iterationFocusArtifacts.get(issue.id) || []),
          ...(currentIterationProvenFocusIds.has(issue.id) ? [paths.patchQueueReport, paths.mergeReport] : []),
          ...(Array.isArray(issue?.artifacts) ? issue.artifacts : [])
        ]))
      : [];
    graph = setIssueStatus(
      graph,
      issue.id,
      issueComplete ? 'complete' : 'pending',
      issueArtifacts
    );
  }

  stageFlags = {
    contract_compiled: Boolean(contract.replyAnchor && contract.anchor && contract.targetPath),
    launch_checklist_present: launchChecklistOk,
    loc_accounting_present: locAccountingPresent,
    semantic_bloat_clean: !semanticBloatBlocker,
    selected_tier_scale_proven: !scaleProofBlocker,
    product_code_diff_present: !selectedTierHadLiveWork || productCodeDiffPresent,
    merged_focus_work_present: verifiedFocusProofPresent,
    selected_tier_had_live_work: selectedTierHadLiveWork,
    bounded_ownership_conflicts: Boolean(effectiveUnresolvedRejectedCount === 0),
    selected_artifacts_present: Boolean(leaseState?.history && patchQueue),
    supervisor_outputs_present: true,
    selectedTier: Boolean(selectedTier || scaleQualification?.highestPassingTier || scaleQualification?.provenCoordinationScaleTier)
  };

  blocker = launchChecklistBlocker
    || locAccountingBlocker
    || scaleProofBlocker
    || semanticBloatBlocker
    || (effectiveUnresolvedRejectedCount > 0 && mergedFocusIds.length === 0
      ? makeRejectedPatchBlocker(effectiveUnresolvedRejected)
      : (effectiveUnresolvedRejectedCount > 0 && allFocusComplete)
        ? {
            blocker: `${effectiveUnresolvedRejectedCount} rejected patch candidate(s) remain after all focus lanes were otherwise proven.`,
            nextAction: 'Resolve or quarantine rejected swarm leaves before treating the run as a clean full-clone completion.',
            rejectionSummary: summarizeRejectedPatchCategories(effectiveUnresolvedRejected),
            quarantineReportPath: REJECTED_PATCH_QUARANTINE_REPORT_PATH
          }
      : (!allFocusComplete && !selectedTierHadLiveWork)
        ? {
            blocker: 'Selected live qualification tier reported green without any live shard work for this run.',
            nextAction: `Reject carried-forward completion for run ${process.env.MAILCHIMP_FULL_AUDIT_RUN_ID || 'unknown'} and repair shard planning or freshness before treating the Mailchimp run as complete. Evidence: shardCount=${selectedTierShardCount}, mergedShardCount=${selectedTierMergedShardCount}, mergedPatchCount=${selectedTierMergedPatchCount}.`
          }
      : (!allFocusComplete && mergedFocusIds.length === 0)
        ? {
            blocker: 'No parity-surface reduction was proven by this iteration.',
            nextAction: 'Produce merged focus-lane patches for at least one remaining red parity surface before re-running.'
          }
        : null);

  saveGraph(paths.issueGraph, graph);
  graphSummary = summarizeGraph(graph);
  const matrixPreview = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
  if (!blocker && resolveMatrixStatus(matrixPreview) !== 'all_complete') {
    blocker = {
      blocker: 'Partial parity-surface reduction was proven, but remaining red surfaces are still open.',
      nextAction: 'Continue with the remaining focus lanes named in surface_matrix.json instead of re-running the same completed focus patches.'
    };
  }
  if (!blocker && !allFocusComplete && priorBlockerReport?.blocker) blocker = priorBlockerReport;
  if (blocker && nextFocus.length === 0 && parityFocusIds.length > 0 && provenFocusIds.size < parityFocusIds.length) {
    nextFocus = parityFocusIds.filter((id) => !provenFocusIds.has(id) && !excludedFocusIds.has(id));
  }
  intendedMatrixStatus = blocker
    ? (resolveMatrixStatus(matrixPreview) === 'all_complete' ? 'all_complete' : 'partial')
    : resolveMatrixStatus(matrixPreview);
  const stageIntegrityOk = Object.values(stageFlags).every((value) => value === true);
  intendedSupervisorStatus = !blocker && intendedMatrixStatus === 'all_complete' && allFocusComplete && stageIntegrityOk ? 'green' : 'red';
  greenComplete = intendedSupervisorStatus === 'green';
} else {
  stageFlags = {
    contract_compiled: Boolean(contract.replyAnchor && contract.anchor && contract.targetPath),
    launch_checklist_present: launchChecklistOk,
    loc_accounting_present: locAccountingPresent,
    semantic_bloat_clean: !semanticBloatBlocker,
    selected_tier_scale_proven: !scaleProofBlocker,
    product_code_diff_present: !selectedTierHadLiveWork || productCodeDiffPresent,
    real_repo_slice_compiled: Boolean(shardPlan?.summary?.shardCount >= 120 && Array.isArray(contextPacks) && contextPacks.length === shardPlan?.shards?.length),
    live_worker_selected_tier_green: Boolean(selectedTierSupervisor?.topLevel?.status === 'green' && selectedTierSummary?.agentCount >= 8 && !scaleProofBlocker),
    zero_state_loss: Boolean((selectedTierSummary?.metrics?.stateLossEvents || 0) === 0 && (recoveryReport?.stateLossEvents || 0) === 0),
    bounded_ownership_conflicts: Boolean(unresolvedRejectedCount === 0 && (mergeReport?.rejectedPatchCount || 0) === 0),
    staged_ladder_honest: Boolean(attemptedTiers[0] === 8 && highestPassingTier !== null),
    repo_integrity_green: Boolean(validationIndex.baseline?.ok && finalRepoTests.ok && finalSmoke.ok),
    selected_artifacts_present: Boolean(leaseState?.history && patchQueue && Array.isArray(contextPacks) && contextPacks.length >= 120),
    supervisor_outputs_present: true
  };

  const derivedBlocker = (launchChecklistBlocker || locAccountingBlocker || scaleProofBlocker || semanticBloatBlocker || (!highestPassingTier
    ? {
        blocker: 'No clean-baseline live tier was honestly proven.',
        nextAction: 'Inspect the first attempted tier under artifacts/qualification/orchestrator_real_repo_clean_baseline/live_runs and repair worker/verifier failures before rerunning.'
      }
    : !finalSmoke.ok || !finalRepoTests.ok
      ? {
          blocker: 'Clean-baseline qualification reached a passing tier, but final smoke/final repo tests did not complete successfully.',
          nextAction: 'Inspect validation files under artifacts/qualification/orchestrator_real_repo_clean_baseline/validation and rerun the clean orchestrator after fixing finalization.'
        }
      : !stageFlags.zero_state_loss
        ? {
            blocker: 'State loss or continuity failure was observed during the selected clean-baseline live tier.',
            nextAction: 'Inspect recovery and selected tier artifacts and fix continuity loss before rerunning.'
          }
        : null));
  blocker = derivedBlocker || null;

  greenComplete = !blocker && Object.values(stageFlags).every(Boolean);
  if (greenComplete) {
    graph = setIssueStatus(graph, 'q5.supervisor_state', 'complete', [paths.programState, paths.completionSummary, paths.notificationState, paths.launchChecklist, paths.locAccounting, paths.supervisorStatus]);
  } else {
    graph = setIssueStatus(graph, 'q5.supervisor_state', blocker ? 'blocked' : 'pending', [paths.programState, paths.completionSummary, paths.notificationState, paths.launchChecklist, paths.locAccounting, paths.supervisorStatus]);
  }
  if (stageFlags.contract_compiled && stageFlags.real_repo_slice_compiled) graph = setIssueStatus(graph, 'q1.real_repo_parallel_slice', 'complete', [paths.contract, paths.workGraph, paths.shardPlan, paths.contextPacks, paths.verifierCatalog]);
  else graph = setIssueStatus(graph, 'q1.real_repo_parallel_slice', blocker ? 'blocked' : 'pending', [paths.contract, paths.workGraph, paths.shardPlan, paths.contextPacks, paths.verifierCatalog]);
  if (stageFlags.live_worker_selected_tier_green) graph = setIssueStatus(graph, 'q2.live_worker_execution', 'complete', [paths.liveExecutionSummary, paths.leaseState, paths.patchQueueReport, paths.mergeReport, paths.recoveryReport]);
  else graph = setIssueStatus(graph, 'q2.live_worker_execution', blocker ? 'blocked' : 'pending', [paths.liveExecutionSummary, paths.leaseState, paths.patchQueueReport, paths.mergeReport, paths.recoveryReport]);
  if (stageFlags.staged_ladder_honest) graph = setIssueStatus(graph, 'q3.staged_scale_ladder', 'complete', [paths.scaleQualification, paths.selectedTierSupervisor, paths.selectedTierSummary]);
  else graph = setIssueStatus(graph, 'q3.staged_scale_ladder', blocker ? 'blocked' : 'pending', [paths.scaleQualification]);
  if (stageFlags.repo_integrity_green) graph = setIssueStatus(graph, 'q4.repo_integrity', 'complete', [paths.validationIndex]);
  else graph = setIssueStatus(graph, 'q4.repo_integrity', blocker ? 'blocked' : 'pending', [paths.validationIndex]);

  saveGraph(paths.issueGraph, graph);
  graphSummary = summarizeGraph(graph);
  intendedSupervisorStatus = greenComplete ? 'green' : 'red';
  intendedMatrixStatus = greenComplete ? 'all_complete' : 'partial';
}

recoverCampaign(paths.campaignState, {
  contractPath: paths.contract,
  graphPath: paths.issueGraph,
  matrixPath: paths.surfaceMatrix
});
let campaignState = setSupervisor(paths.campaignState, {
  status: intendedSupervisorStatus,
  blocker: blocker || null,
  matrixStatus: intendedMatrixStatus,
  note: greenComplete
    ? 'cleaned-baseline real repo orchestrator qualification reached supervisor-green completion with honest tier reporting'
    : 'cleaned-baseline real repo orchestrator qualification stopped with blocker or partial truth state'
});

let programState = {
  generatedAt: new Date().toISOString(),
  supervisorStatus: intendedSupervisorStatus,
  allComplete: greenComplete,
  matrixPath: paths.surfaceMatrix,
  matrixStatus: intendedMatrixStatus,
  provenCoordinationScaleTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  stopReason: scaleQualification.realRepoLive.stopReason,
  graphSummary,
  stages: Object.entries(stageFlags).map(([id, complete]) => ({ id, complete })),
  evidence: {
    contract: paths.contract,
    graph: paths.issueGraph,
    workGraph: paths.workGraph,
    shardPlan: paths.shardPlan,
    contextPacks: paths.contextPacks,
    validationIndex: paths.validationIndex,
    scaleQualification: paths.scaleQualification,
    selectedTierSupervisor: paths.selectedTierSupervisor,
    selectedTierSummary: paths.selectedTierSummary,
    leaseState: paths.leaseState,
    patchQueueReport: paths.patchQueueReport,
    mergeReport: paths.mergeReport,
    recoveryReport: paths.recoveryReport,
    launchChecklist: paths.launchChecklist,
    locAccounting: paths.locAccounting,
    blockerReport: blocker ? paths.blockerReport : null,
    productOnlyFocusEvidence
  },
  blocker: blocker || null,
  nextFocus,
  campaignState
};

let completionSummary = {
  generatedAt: new Date().toISOString(),
  supervisorConfirmedCompletion: greenComplete,
  supervisorStatus: intendedSupervisorStatus,
  surfaceMatrixPath: paths.surfaceMatrix,
  surfaceMatrixStatus: intendedMatrixStatus,
  targetPath: contract.targetPath,
  provenCoordinationScaleTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  replyAnchor: contract.replyAnchor,
  launchChecklistPath: paths.launchChecklist,
  locAccountingPath: paths.locAccounting,
  locAccountingSummary: locAccounting?.counts || null,
  incrementalLocAccountingSummary: locAccounting?.incremental?.counts || null,
  productLocTruth: locAccounting?.productLocTruth || null,
  productOnlyFocusEvidence,
  blocker: blocker || null,
  nextFocus,
  stopReason: scaleQualification.realRepoLive.stopReason,
  stages: programState.stages
};

let notificationState = {
  delivered: false,
  deliveredAt: null,
  awaitingNotifier: completionSummary.supervisorConfirmedCompletion,
  supervisorStatus: completionSummary.supervisorStatus,
  provenCoordinationScaleTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  note: completionSummary.supervisorConfirmedCompletion ? 'ready for requester relay' : 'blocked or partial; requester relay should include blocker status'
};

writeJson(paths.programState, programState);
writeJson(paths.completionSummary, completionSummary);
writeJson(paths.notificationState, notificationState);
writeJson(paths.supervisorStatus, {
  generatedAt: new Date().toISOString(),
  truth: {
    supervisorStatus: intendedSupervisorStatus,
    stopAllowed: greenComplete
  },
  supervisorStatus: intendedSupervisorStatus,
  surfaceMatrixStatus: intendedMatrixStatus,
  provenCoordinationScaleTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  stages: programState.stages,
  productLocTruth: locAccounting?.productLocTruth || null,
  blocker: blocker || null,
  stopReason: scaleQualification.realRepoLive.stopReason,
  provisional: true
});

let matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(paths.surfaceMatrix, matrix);
let truth = deriveSupervisorTruth(matrix);
const finalAllComplete = greenComplete && !blocker && truth.supervisorStatus === 'green' && matrix.status === 'all_complete';
const finalBlocker = finalAllComplete ? null : blocker;
const finalSupervisorStatus = finalAllComplete ? 'green' : 'red';
const finalStages = programState.stages;

campaignState = setSupervisor(paths.campaignState, {
  status: finalSupervisorStatus,
  blocker: finalBlocker || null,
  matrixStatus: matrix.status,
  note: finalAllComplete
    ? 'cleaned-baseline real repo orchestrator qualification reached supervisor-green completion with honest tier reporting'
    : 'cleaned-baseline real repo orchestrator qualification stopped with blocker or partial truth state'
});
programState = {
  ...programState,
  supervisorStatus: finalSupervisorStatus,
  allComplete: finalAllComplete,
  matrixStatus: matrix.status,
  stages: finalStages,
  productLocTruth: locAccounting?.productLocTruth || null,
  blocker: finalBlocker || null,
  campaignState
};
completionSummary = {
  ...completionSummary,
  supervisorConfirmedCompletion: finalAllComplete,
  supervisorStatus: finalSupervisorStatus,
  surfaceMatrixStatus: matrix.status,
  stages: finalStages,
  blocker: finalBlocker || null
};
notificationState = {
  ...notificationState,
  awaitingNotifier: completionSummary.supervisorConfirmedCompletion,
  supervisorStatus: completionSummary.supervisorStatus,
  note: completionSummary.supervisorConfirmedCompletion ? 'ready for requester relay' : 'blocked or partial; requester relay should include blocker status'
};

writeJson(paths.programState, programState);
writeJson(paths.completionSummary, completionSummary);
writeJson(paths.notificationState, notificationState);
writeJson(paths.supervisorStatus, {
  generatedAt: new Date().toISOString(),
  truth,
  supervisorStatus: completionSummary.supervisorStatus,
  surfaceMatrixStatus: matrix.status,
  provenCoordinationScaleTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  stages: finalStages,
  productLocTruth: locAccounting?.productLocTruth || null,
  blocker: finalBlocker || null,
  stopReason: scaleQualification.realRepoLive.stopReason
});
if (finalBlocker) {
  writeJson(paths.blockerReport, finalBlocker);
} else if (exists(paths.blockerReport)) {
  fs.unlinkSync(paths.blockerReport);
}

console.log(JSON.stringify({
  supervisorStatus: completionSummary.supervisorStatus,
  matrixStatus: matrix.status,
  provenCoordinationScaleTier,
  blocker: finalBlocker || null
}, null, 2));
process.exit(completionSummary.supervisorStatus === 'green' ? 0 : 1);
