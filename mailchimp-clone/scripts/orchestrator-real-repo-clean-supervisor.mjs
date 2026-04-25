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

function computeLocAccounting(repoRoot, { runForArtifacts = null, selectedTier = null } = {}) {
  const diff = spawnSync('git', ['diff', '--numstat', '--find-renames=90%', 'HEAD', '--', '.'], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024
  });
  if (diff.status !== 0 || diff.error) {
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
  return {
    generatedAt: new Date().toISOString(),
    ok: true,
    repoRoot,
    baseline: { type: 'git_head_worktree_diff', ref: 'HEAD' },
    selectedTier,
    runRoot: runForArtifacts?.runRoot || null,
    mergedPatchCount: Number(runForArtifacts?.patchQueue?.merged?.length || 0),
    requiredForCompletion: true,
    counts: {
      all,
      productCode,
      tests,
      scripts,
      docs,
      artifacts,
      other
    },
    changedFiles: entries,
    productCodeFiles: entries.filter((entry) => entry.category === 'productCode'),
    note: 'Counts reflect surviving uncommitted diff against HEAD, not cumulative churn during the run.'
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
const selectedTierHadLiveWork = selectedTierShardCount > 0 || selectedTierMergedShardCount > 0 || selectedTierMergedPatchCount > 0;
const launchChecklist = readJson(paths.launchChecklist, null);
const locAccounting = computeLocAccounting(contract.targetPath || process.cwd(), { runForArtifacts, selectedTier });
writeJson(paths.locAccounting, locAccounting);
const launchChecklistOk = Boolean(launchChecklist?.ok) && Array.isArray(launchChecklist?.items) && launchChecklist.items.every((entry) => entry?.ok === true);
const locAccountingPresent = Boolean(locAccounting?.ok);
const productCodeLineDelta = Number(locAccounting?.counts?.productCode?.added || 0) + Number(locAccounting?.counts?.productCode?.deleted || 0);
const productCodeDiffPresent = productCodeLineDelta > 0 && Number(locAccounting?.counts?.productCode?.files || 0) > 0;

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
  highestPassingTier,
  provenCoordinationScaleTier: highestPassingTier,
  realRepoLive: {
    attemptedTiers,
    highestPassingTier,
    repoIntegrity: {
      baselineRepoTestsOk: Boolean(validationIndex.baseline?.ok),
      finalRepoTestsOk: Boolean(finalRepoTests.ok),
      finalSmokeOk: Boolean(finalSmoke.ok)
    },
    honestResult: highestPassingTier ? `Highest honestly proven coordination tier on cleaned baseline: ${highestPassingTier}` : null,
    stopReason: highestPassingTier && finalSmoke.ok && finalRepoTests.ok
      ? `Qualification completed cleanly at tier ${highestPassingTier}.`
      : highestPassingTier
        ? `Qualification reached tier ${highestPassingTier}, but final smoke/final repo tests did not complete successfully.`
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

let blocker = null;
let graphSummary;
let intendedSupervisorStatus;
let intendedMatrixStatus;
let greenComplete = false;
let stageFlags;
let nextFocus = [];

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
  const completedFocusIds = new Set(normalizeFocusIds(String(process.env.MAILCHIMP_COMPLETED_FOCUS_IDS || '')
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
  const parityFocusIds = mailchimpParityFocusIds();
  nextFocus = parityFocusIds.filter((id) => !provenFocusIds.has(id));
  const issueSatisfied = (issueId) => provenFocusIds.has(issueId) || !parityFocusIds.includes(issueId);
  const allFocusComplete = nextFocus.length === 0 && focusIssues.every((issue) => issueSatisfied(issue.id));

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
    product_code_diff_present: !selectedTierHadLiveWork || productCodeDiffPresent,
    merged_focus_work_present: mergedFocusIds.length > 0,
    selected_tier_had_live_work: selectedTierHadLiveWork,
    bounded_ownership_conflicts: Boolean(unresolvedRejectedCount === 0 && (mergeReport?.rejectedPatchCount || 0) === 0),
    selected_artifacts_present: Boolean(leaseState?.history && patchQueue),
    supervisor_outputs_present: true,
    selectedTier: Boolean(selectedTier || scaleQualification?.highestPassingTier || scaleQualification?.provenCoordinationScaleTier),
    mergedFocusIds
  };

  blocker = launchChecklistBlocker
    || locAccountingBlocker
    || (unresolvedRejectedCount > 0
      ? makeRejectedPatchBlocker(unresolvedRejected)
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
    nextFocus = parityFocusIds.filter((id) => !provenFocusIds.has(id));
  }
  intendedMatrixStatus = blocker
    ? (resolveMatrixStatus(matrixPreview) === 'all_complete' ? 'all_complete' : 'partial')
    : resolveMatrixStatus(matrixPreview);
  intendedSupervisorStatus = !blocker && intendedMatrixStatus === 'all_complete' ? 'green' : 'red';
  greenComplete = intendedSupervisorStatus === 'green';
} else {
  stageFlags = {
    contract_compiled: Boolean(contract.replyAnchor && contract.anchor && contract.targetPath),
    launch_checklist_present: launchChecklistOk,
    loc_accounting_present: locAccountingPresent,
    product_code_diff_present: !selectedTierHadLiveWork || productCodeDiffPresent,
    real_repo_slice_compiled: Boolean(shardPlan?.summary?.shardCount >= 120 && Array.isArray(contextPacks) && contextPacks.length === shardPlan?.shards?.length),
    live_worker_selected_tier_green: Boolean(selectedTierSupervisor?.topLevel?.status === 'green' && selectedTierSummary?.agentCount >= 8),
    zero_state_loss: Boolean((selectedTierSummary?.metrics?.stateLossEvents || 0) === 0 && (recoveryReport?.stateLossEvents || 0) === 0),
    bounded_ownership_conflicts: Boolean(unresolvedRejectedCount === 0 && (mergeReport?.rejectedPatchCount || 0) === 0),
    staged_ladder_honest: Boolean(attemptedTiers[0] === 8 && highestPassingTier !== null),
    repo_integrity_green: Boolean(validationIndex.baseline?.ok && finalRepoTests.ok && finalSmoke.ok),
    selected_artifacts_present: Boolean(leaseState?.history && patchQueue && Array.isArray(contextPacks) && contextPacks.length >= 120),
    supervisor_outputs_present: true
  };

  const derivedBlocker = (launchChecklistBlocker || locAccountingBlocker || (!highestPassingTier
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
  provenCoordinationScaleTier: highestPassingTier,
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
    blockerReport: blocker ? paths.blockerReport : null
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
  provenCoordinationScaleTier: highestPassingTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  replyAnchor: contract.replyAnchor,
  launchChecklistPath: paths.launchChecklist,
  locAccountingPath: paths.locAccounting,
  locAccountingSummary: locAccounting?.counts || null,
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
  provenCoordinationScaleTier: highestPassingTier,
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
  provenCoordinationScaleTier: highestPassingTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  stages: programState.stages,
  blocker: blocker || null,
  stopReason: scaleQualification.realRepoLive.stopReason,
  provisional: true
});

let matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(paths.surfaceMatrix, matrix);
let truth = deriveSupervisorTruth(matrix);
const finalAllComplete = !blocker && truth.supervisorStatus === 'green' && matrix.status === 'all_complete';
const finalBlocker = finalAllComplete ? null : blocker;
const finalSupervisorStatus = finalAllComplete ? 'green' : 'red';
const finalStages = finalAllComplete
  ? programState.stages.map((stage) => ({ ...stage, complete: true }))
  : programState.stages;

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
  provenCoordinationScaleTier: highestPassingTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  stages: finalStages,
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
  provenCoordinationScaleTier: highestPassingTier,
  blocker: finalBlocker || null
}, null, 2));
process.exit(completionSummary.supervisorStatus === 'green' ? 0 : 1);
