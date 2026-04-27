import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compileTaskContract, saveContract } from '../../large-project-capability-stack/packages/task-contract/index.mjs';
import { parsePorcelainStatus } from './lib/full-audit-campaign-sync-pathspecs.mjs';
import { createIssueGraph, upsertIssue, linkDependency, saveGraph, setIssueStatus } from '../../large-project-capability-stack/packages/issue-dag/index.mjs';
import { compileSurfaceMatrix, saveMatrix } from '../../large-project-capability-stack/packages/surface-matrix/index.mjs';
import { initializeCampaign, recoverCampaign, claimWorkerIteration, updateWorker, completeWorkerIteration } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { buildShardPlan, createArtifactBus, compileContextPacks, runLiveWorkerFarm, saveJson } from '../../large-project-capability-stack/packages/multi-agent-orchestrator/index.mjs';
import {
  ROOT,
  ARTIFACT_ROOT,
  VALIDATION_DIR,
  RUNS_DIR,
  MERGE_DIR,
  RECOVERY_DIR,
  WORKER_SCRIPT,
  VERIFIER_SCRIPT,
  STACK_FIXTURE_SCALE_PATH,
  paths,
  ensureDirs,
  contractInput,
  issueDefinitions,
  surfaceDefinitions,
  buildSelectedWorkGraphSeed,
  buildFailurePlan,
  buildVerifierCatalog,
  PRODUCT_ONLY_MODE,
  tierRunDir,
  readJson,
  writeJson,
  extractVerifiedFocusIdsFromPatchQueue
} from './lib/orchestrator-real-repo-clean-plan.mjs';

function resetQualificationArtifacts() {
  for (const target of [RUNS_DIR, MERGE_DIR, RECOVERY_DIR]) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {}
  }
  for (const filePath of [
    paths.liveExecutionSummary,
    paths.patchQueueReport,
    paths.scaleQualification,
    paths.selectedTierSummary,
    paths.selectedTierSupervisor,
    paths.leaseState,
    paths.validationIndex,
    paths.workGraph,
    paths.issueGraph,
    paths.shardPlan,
    paths.contextPacks,
    paths.completionSummary,
    paths.programState,
    paths.launchChecklist,
    paths.locAccounting,
    paths.canonicalSummary,
    paths.blockerReport,
    paths.supervisorStatus,
    paths.notifierEligibility
  ]) {
    try {
      fs.rmSync(filePath, { recursive: true, force: true });
    } catch {}
  }
}

function runCommand(command, args, { cwd = ROOT, logPath, allowFailure = false } = {}) {
  const startedAt = Date.now();
  const rendered = [command, ...args].join(' ');
  try {
    const output = execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    if (logPath) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, output);
    }
    return { ok: true, command: rendered, output, durationMs: Date.now() - startedAt, logPath };
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}${error.message || ''}`;
    if (logPath) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, output);
    }
    if (!allowFailure) throw error;
    return { ok: false, command: rendered, output, durationMs: Date.now() - startedAt, logPath };
  }
}

function honestResult(highestPassingTier, attemptedTier, blocker) {
  if (blocker) return `blocked before honest qualification could complete at tier ${attemptedTier ?? 'n/a'}`;
  if (highestPassingTier === 100) return '100 live qualified on the real Mailchimp repo';
  if (highestPassingTier) return `${highestPassingTier} live qualified on the real Mailchimp repo; higher tier not proven`; 
  return 'no live tier qualified on the real Mailchimp repo';
}

function createMergeReport(run, selectedTier) {
  return {
    generatedAt: new Date().toISOString(),
    selectedTier,
    mergedPatchCount: run?.patchQueue?.merged?.length || 0,
    queuedPatchCount: run?.patchQueue?.queued?.length || 0,
    rejectedPatchCount: run?.patchQueue?.rejected?.length || 0,
    rejectedPatches: (run?.patchQueue?.rejected || []).map((entry) => ({ id: entry.id, shardId: entry.shardId, conflicts: entry.conflicts || [], verifierResults: entry.verifierResults || [] })),
    mergedPatchIds: (run?.patchQueue?.merged || []).slice(0, 25).map((entry) => entry.id)
  };
}

function createRecoveryReport(run, selectedTier) {
  return {
    generatedAt: new Date().toISOString(),
    selectedTier,
    staleLeaseCount: run?.metrics?.staleLeaseCount || 0,
    recoveryCount: run?.metrics?.recoveryCount || 0,
    workerExitFailures: run?.metrics?.workerExitFailures || 0,
    crashInjectionCount: run?.metrics?.crashInjectionCount || 0,
    stallInjectionCount: run?.metrics?.stallInjectionCount || 0,
    lateResultsIgnored: run?.metrics?.lateResultsIgnored || 0,
    stateLossEvents: run?.metrics?.stateLossEvents || 0,
    continuityFailures: run?.metrics?.continuityFailures || []
  };
}

resetQualificationArtifacts();
ensureDirs();

const contract = saveContract(paths.contract, compileTaskContract(contractInput()));
let graph = createIssueGraph({ title: 'mailchimp-real-repo-orchestrator-qualification', targetPath: ROOT });
for (const issue of issueDefinitions()) graph = upsertIssue(graph, { status: 'pending', owner: 'orchestrator', ...issue });
for (const issue of issueDefinitions()) {
  for (const dep of issue.deps || []) graph = linkDependency(graph, issue.id, dep);
}
saveGraph(paths.issueGraph, graph);
saveMatrix(paths.surfaceMatrix, compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() }));

const resumeCampaign = process.env.ORCHESTRATOR_RESUME_CAMPAIGN === '1';
if (!resumeCampaign || !fs.existsSync(paths.campaignState)) {
  initializeCampaign(paths.campaignState, {
    mode: 'persistent',
    stopCondition: 'supervisor_green_or_blocker_report',
    contractPath: paths.contract,
    graphPath: paths.issueGraph,
    matrixPath: paths.surfaceMatrix
  });
} else {
  recoverCampaign(paths.campaignState);
}
claimWorkerIteration(paths.campaignState, {
  claimedBy: 'scripts/orchestrator-real-repo-run.mjs',
  reason: 'real_mailchimp_repo_orchestrator_qualification'
});
updateWorker(paths.campaignState, { id: 'qualification.start', ok: true, note: 'starting staged live qualification on the real Mailchimp repo' });

const fixtureBaseline = readJson(STACK_FIXTURE_SCALE_PATH, null);
const seed = buildSelectedWorkGraphSeed();
writeJson(paths.workGraph, seed.workGraph);
writeJson(paths.workSurfaceMatrix, seed.surfaceMatrix);
writeJson(paths.verifierCatalog, buildVerifierCatalog());

const IMPLEMENTATION_SCRIPT = process.env.ORCHESTRATOR_IMPLEMENTATION_SCRIPT || path.join(ROOT, 'scripts', 'orchestrator-real-repo-clean-implement.mjs');

function buildAllowedDirtyWorkspaceEntries() {
  const allowed = new Set();
  if (process.env.MAILCHIMP_REMOTE_EXECUTION_CONTEXT !== '1') return allowed;
  allowed.add('node_modules');
  allowed.add('artifacts');
  const artifactRoot = process.env.MAILCHIMP_ORCHESTRATOR_ARTIFACT_ROOT || null;
  const overlayManifestPath = artifactRoot ? path.join(artifactRoot, 'baseline_overlay.json') : null;
  if (!overlayManifestPath || !fs.existsSync(overlayManifestPath)) return allowed;
  const overlayManifest = JSON.parse(fs.readFileSync(overlayManifestPath, 'utf8'));
  for (const operation of overlayManifest?.operations || []) {
    if (operation?.path) allowed.add(operation.path);
    if (operation?.fromPath) allowed.add(operation.fromPath);
  }
  return allowed;
}

function assertWorkspaceReadyForImplementation() {
  if (!IMPLEMENTATION_SCRIPT) return;
  if (process.env.ORCHESTRATOR_ALLOW_DIRTY_WORKSPACE === '1') return;
  const porcelain = execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim();
  if (!porcelain) return;
  const allowed = buildAllowedDirtyWorkspaceEntries();
  const disallowed = parsePorcelainStatus(porcelain)
    .filter((entry) => !allowed.has(entry.path) && !(entry.fromPath && allowed.has(entry.fromPath)));
  if (!disallowed.length) return;
  throw new Error(`Implementation mode requires a clean workspace before launch. Dirty files detected:\n${disallowed.map((entry) => `${entry.status} ${entry.fromPath ? `${entry.fromPath} -> ` : ''}${entry.path}`).join('\n')}`);
}

assertWorkspaceReadyForImplementation();

const tiers = String(process.env.ORCHESTRATOR_TIERS || '8,16,32,64,100').split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value > 0);

function buildLaunchChecklist({ baselineRepoTests }) {
  const items = [
    {
      id: 'target_path_resolved',
      ok: fs.existsSync(ROOT),
      detail: ROOT
    },
    {
      id: 'implementation_script_present',
      ok: Boolean(IMPLEMENTATION_SCRIPT && fs.existsSync(IMPLEMENTATION_SCRIPT)),
      detail: IMPLEMENTATION_SCRIPT
    },
    {
      id: 'workspace_guard_passed',
      ok: true,
      detail: process.env.ORCHESTRATOR_ALLOW_DIRTY_WORKSPACE === '1'
        ? 'dirty workspace explicitly allowed by env override'
        : (process.env.MAILCHIMP_REMOTE_EXECUTION_CONTEXT === '1'
          ? 'workspace checked with remote overlay allowlist'
          : 'workspace checked clean before launch')
    },
    {
      id: 'stop_condition_guarded',
      ok: (contract.stopCondition || 'supervisor_green_or_blocker_report') === 'supervisor_green_or_blocker_report',
      detail: contract.stopCondition || 'supervisor_green_or_blocker_report'
    },
    {
      id: 'requested_tiers_resolved',
      ok: tiers.length > 0,
      detail: tiers.join(',')
    },
    {
      id: 'loc_accounting_required',
      ok: true,
      detail: path.relative(ROOT, paths.locAccounting)
    },
    {
      id: 'baseline_repo_tests_green',
      ok: Boolean(baselineRepoTests?.ok),
      detail: baselineRepoTests?.logPath || null
    }
  ];
  return {
    generatedAt: new Date().toISOString(),
    targetPath: ROOT,
    requestedFidelity: contract.requestedFidelity,
    qualificationMode: 'real_mailchimp_repo_live_worker_farm',
    productOnlyMode: PRODUCT_ONLY_MODE,
    implementationScript: IMPLEMENTATION_SCRIPT,
    requestedTiers: tiers,
    locAccountingPath: paths.locAccounting,
    items,
    ok: items.every((entry) => entry.ok)
  };
}

const shardPlan = buildShardPlan({
  workGraph: seed.workGraph,
  surfaceMatrix: seed.surfaceMatrix,
  options: {
    maxFileAreasPerShard: 8,
    maxFilesPerShard: 128,
    maxAcceptanceChecksPerShard: 8
  }
});
writeJson(paths.shardPlan, shardPlan);

const contextPacks = compileContextPacks({
  contract,
  shardPlan,
  surfaceMatrix: seed.surfaceMatrix,
  artifactBus: createArtifactBus({ rootPath: ARTIFACT_ROOT }),
  globalInputs: seed.globalInputs
});
writeJson(paths.contextPacks, contextPacks);

const validationIndex = {
  generatedAt: new Date().toISOString(),
  baseline: null,
  perTierRepoTests: [],
  finalSmoke: null,
  finalRepoTests: null
};

const tierTracePath = path.join(ARTIFACT_ROOT, 'tier_trace.json');

function updateTierTrace(patch = {}) {
  const previous = readJson(tierTracePath, {});
  const next = {
    ...previous,
    generatedAt: new Date().toISOString(),
    ...patch
  };
  writeJson(tierTracePath, next);
  return next;
}

const baselineLog = path.join(VALIDATION_DIR, 'baseline_repo_tests.log');
const baselineRepoTests = PRODUCT_ONLY_MODE
  ? { ok: true, skipped: true, reason: 'product_only_mode', command: 'skipped: product_only_mode', logPath: baselineLog, durationMs: 0 }
  : runCommand('npm', ['test', '--', '--runInBand'], { cwd: ROOT, logPath: baselineLog, allowFailure: true });
validationIndex.baseline = { ok: baselineRepoTests.ok, skipped: Boolean(baselineRepoTests.skipped), reason: baselineRepoTests.reason || null, command: baselineRepoTests.command, logPath: baselineLog, durationMs: baselineRepoTests.durationMs };
writeJson(paths.validationIndex, validationIndex);
writeJson(paths.launchChecklist, buildLaunchChecklist({ baselineRepoTests }));
if (!baselineRepoTests.ok) {
  const blocker = {
    generatedAt: new Date().toISOString(),
    blocker: 'Baseline repo tests failed before live qualification started.',
    nextAction: `Inspect ${baselineLog} and restore the Mailchimp repo to a green baseline before rerunning.`
  };
  writeJson(paths.blockerReport, blocker);
  updateWorker(paths.campaignState, { id: 'qualification.baseline', ok: false, note: blocker.blocker });
  completeWorkerIteration(paths.campaignState, { ok: false, note: blocker.blocker, outcome: blocker });
  console.log(JSON.stringify({ ok: false, artifactRoot: ARTIFACT_ROOT, blocker }, null, 2));
  process.exit(1);
}

updateWorker(paths.campaignState, { id: 'qualification.plan', ok: shardPlan.summary.shardCount >= 120, shardCount: shardPlan.summary.shardCount, contextPackCount: contextPacks.length });

const leaseTtlMs = 15000;
const failurePlan = buildFailurePlan({ shardPlan, leaseTtlMs });
writeJson(path.join(ARTIFACT_ROOT, 'failure_injections.json'), failurePlan);

const tierResults = [];
let highestPassingTier = null;
let selectedRun = null;
let lastAttemptedRun = null;
let blockerReport = null;
let stopReason = null;

for (const tier of tiers) {
  updateTierTrace({
    stage: 'tier_start',
    tier,
    attemptedTiers: [...tierResults.map((entry) => entry.tier), tier],
    highestPassingTier,
    runRoot: tierRunDir(tier)
  });

  const liveRun = await runLiveWorkerFarm({
    workGraph: seed.workGraph,
    surfaceMatrix: seed.surfaceMatrix,
    agentCount: tier,
    workerScriptPath: WORKER_SCRIPT,
    verifierScriptPath: VERIFIER_SCRIPT,
    implementationScriptPath: IMPLEMENTATION_SCRIPT,
    workspacePath: ROOT,
    runRoot: tierRunDir(tier),
    campaignContract: contract,
    leaseTtlMs,
    maxRuntimeMs: 900000,
    pollMs: 50,
    workerMemoryLimitMb: tier >= 64 ? 48 : 64,
    maxSpawnsPerTick: tier >= 100 ? 2 : tier >= 64 ? 2 : tier >= 32 ? 4 : tier,
    plannerOptions: {
      maxFileAreasPerShard: 8,
      maxFilesPerShard: 128,
      maxAcceptanceChecksPerShard: 8
    },
    failureInjections: failurePlan,
    globalInputs: seed.globalInputs,
    executionMode: 'real_mailchimp_repo_live_worker_farm',
    allowProductOnlyVerifierSkip: PRODUCT_ONLY_MODE
  });
  lastAttemptedRun = liveRun;

  updateTierTrace({
    stage: 'tier_live_run_complete',
    tier,
    highestPassingTier,
    liveRunOk: liveRun.ok,
    liveRunMetrics: liveRun.metrics,
    liveRunRoot: liveRun.runRoot,
    liveRunSupervisorStatus: liveRun.supervisor?.topLevel?.status || null
  });

  const repoTestLog = path.join(VALIDATION_DIR, `tier-${String(tier).padStart(3, '0')}_repo_tests.log`);
  updateTierTrace({
    stage: 'tier_repo_tests_start',
    tier,
    repoTestLog
  });
  const repoTests = PRODUCT_ONLY_MODE
    ? { ok: true, skipped: true, reason: 'product_only_mode', command: 'skipped: product_only_mode', logPath: repoTestLog, durationMs: 0 }
    : runCommand('npm', ['test', '--', '--runInBand'], { cwd: ROOT, logPath: repoTestLog, allowFailure: true });
  validationIndex.perTierRepoTests.push({ tier, ok: repoTests.ok, skipped: Boolean(repoTests.skipped), reason: repoTests.reason || null, command: repoTests.command, logPath: repoTestLog, durationMs: repoTests.durationMs });
  writeJson(paths.validationIndex, validationIndex);

  const tierSummary = {
    tier,
    ok: liveRun.ok && repoTests.ok,
    liveRunOk: liveRun.ok,
    repoTestsOk: repoTests.ok,
    executionMode: liveRun.executionMode,
    shardCount: liveRun.shardPlan.shards.length,
    mergedShardCount: liveRun.patchQueue.merged.length,
    supervisorStatus: liveRun.supervisor.topLevel.status,
    recoveryCount: liveRun.metrics.recoveryCount,
    staleLeaseCount: liveRun.metrics.staleLeaseCount,
    stateLossEvents: liveRun.metrics.stateLossEvents,
    continuityFailures: liveRun.metrics.continuityFailures,
    workerExitFailures: liveRun.metrics.workerExitFailures,
    rejectedPatchCount: liveRun.patchQueue.rejected.length,
    runRoot: liveRun.runRoot,
    repoTestLog,
    repoTestCommand: repoTests.command
  };
  updateTierTrace({
    stage: 'tier_complete',
    tier,
    tierSummary,
    highestPassingTier: tierSummary.ok ? tier : highestPassingTier
  });
  tierResults.push(tierSummary);
  updateWorker(paths.campaignState, { id: `qualification.tier.${tier}`, ok: tierSummary.ok, ...tierSummary });

  if (tierSummary.ok) {
    highestPassingTier = tier;
    selectedRun = liveRun;
    continue;
  }

  if (!repoTests.ok || liveRun.metrics.stateLossEvents > 0 || liveRun.patchQueue.rejected.length > 0 || highestPassingTier === null) {
    blockerReport = {
      generatedAt: new Date().toISOString(),
      blocker: !repoTests.ok
        ? `Repo tests failed after attempting tier ${tier}.`
        : liveRun.metrics.stateLossEvents > 0
          ? `State loss or continuity failures were detected at tier ${tier}.`
          : liveRun.patchQueue.rejected.length > 0
            ? `Patch queue rejected work at tier ${tier}, indicating ownership or verifier instability.`
            : `No live tier could be honestly proven; first attempted tier ${tier} failed.`,
      nextAction: !repoTests.ok
        ? `Inspect ${repoTestLog} and ${path.join(liveRun.runRoot, 'summary.json')} before retrying.`
        : `Inspect ${path.join(liveRun.runRoot, 'summary.json')} and ${path.join(liveRun.runRoot, 'supervisor.json')} to fix live worker failures before rerunning.`
    };
    stopReason = blockerReport.blocker;
  } else {
    stopReason = `Stopped after tier ${tier} because the next scale step was not healthy; capped qualification at ${highestPassingTier}.`;
  }
  break;
}

const selectedTier = highestPassingTier || lastAttemptedRun?.agentCount || null;
const runForArtifacts = selectedRun || lastAttemptedRun;

if (runForArtifacts) {
  writeJson(paths.selectedTierSupervisor, runForArtifacts.supervisor);
  writeJson(paths.selectedTierSummary, runForArtifacts.summary);
  writeJson(paths.leaseState, runForArtifacts.leaseState);
  writeJson(paths.patchQueueReport, runForArtifacts.patchQueue);
  writeJson(paths.artifactBus, runForArtifacts.artifactBus);
  writeJson(paths.workerEvents, runForArtifacts.workerEvents);
  writeJson(paths.liveExecutionSummary, {
    generatedAt: new Date().toISOString(),
    qualificationMode: 'real_mailchimp_repo_live_worker_farm',
    selectedTier,
    shardCount: runForArtifacts.shardPlan.shards.length,
    mergedShardCount: runForArtifacts.patchQueue.merged.length,
    executionMode: runForArtifacts.executionMode,
    runRoot: runForArtifacts.runRoot,
    frontier: runForArtifacts.frontier,
    metrics: runForArtifacts.metrics
  });
  writeJson(paths.mergeReport, createMergeReport(runForArtifacts, selectedTier));
  writeJson(paths.recoveryReport, createRecoveryReport(runForArtifacts, selectedTier));
}

let finalSmoke = PRODUCT_ONLY_MODE
  ? { ok: true, skipped: true, reason: 'product_only_mode', command: 'skipped: product_only_mode', logPath: path.join(VALIDATION_DIR, 'final_smoke.log'), durationMs: 0 }
  : { ok: false, command: 'node scripts/smoke-full-clone.mjs', logPath: path.join(VALIDATION_DIR, 'final_smoke.log'), durationMs: 0 };
if (!PRODUCT_ONLY_MODE && highestPassingTier !== null) {
  updateTierTrace({ stage: 'final_smoke_start', highestPassingTier, logPath: finalSmoke.logPath });
  finalSmoke = runCommand(process.execPath, ['scripts/smoke-full-clone.mjs'], { cwd: ROOT, logPath: finalSmoke.logPath, allowFailure: true });
}
validationIndex.finalSmoke = { ok: finalSmoke.ok, skipped: Boolean(finalSmoke.skipped), reason: finalSmoke.reason || null, command: finalSmoke.command, logPath: finalSmoke.logPath, durationMs: finalSmoke.durationMs };
updateTierTrace({ stage: 'final_smoke_complete', highestPassingTier, finalSmoke });

const finalRepoLog = path.join(VALIDATION_DIR, 'final_repo_tests.log');
updateTierTrace({ stage: 'final_repo_tests_start', highestPassingTier, logPath: finalRepoLog });
const finalRepoTests = PRODUCT_ONLY_MODE
  ? { ok: true, skipped: true, reason: 'product_only_mode', command: 'skipped: product_only_mode', logPath: finalRepoLog, durationMs: 0 }
  : runCommand('npm', ['test', '--', '--runInBand'], { cwd: ROOT, logPath: finalRepoLog, allowFailure: true });
validationIndex.finalRepoTests = { ok: finalRepoTests.ok, skipped: Boolean(finalRepoTests.skipped), reason: finalRepoTests.reason || null, command: finalRepoTests.command, logPath: finalRepoLog, durationMs: finalRepoTests.durationMs };
writeJson(paths.validationIndex, validationIndex);
updateTierTrace({ stage: 'final_repo_tests_complete', highestPassingTier, finalRepoTests: validationIndex.finalRepoTests });

if (!finalSmoke.ok && highestPassingTier !== null && !blockerReport) {
  blockerReport = {
    generatedAt: new Date().toISOString(),
    blocker: 'Final real-repo smoke validation failed after staged qualification.',
    nextAction: `Inspect ${finalSmoke.logPath} and fix the regression before re-qualifying the real repo.`
  };
  stopReason = blockerReport.blocker;
}

if (!finalRepoTests.ok && !blockerReport) {
  blockerReport = {
    generatedAt: new Date().toISOString(),
    blocker: 'Final repo-wide tests failed after qualification attempts.',
    nextAction: `Inspect ${finalRepoLog} and repair repo integrity before rerunning the ladder.`
  };
  stopReason = blockerReport.blocker;
}

const scaleQualification = {
  generatedAt: new Date().toISOString(),
  fixtureBaseline: fixtureBaseline ? {
    artifactPath: STACK_FIXTURE_SCALE_PATH,
    provenCoordinationScaleTier: fixtureBaseline.provenCoordinationScaleTier,
    qualificationMode: fixtureBaseline.qualificationMode,
    liveHighestPassingTier: fixtureBaseline.live?.highestPassingTier || null,
    honestResult: fixtureBaseline.live?.honestResult || null
  } : null,
  realRepoLive: {
    targetPath: ROOT,
    requestedTiers: tiers,
    attemptedTiers: tierResults.map((entry) => entry.tier),
    qualificationMode: 'real_mailchimp_repo_live_worker_farm',
    highestPassingTier,
    allRequestedTiersPassed: highestPassingTier === 100 && tierResults.length === tiers.length && tierResults.every((entry) => entry.ok),
    honestResult: honestResult(highestPassingTier, tierResults.at(-1)?.tier || null, blockerReport),
    stopReason: stopReason || (highestPassingTier === 100 ? 'all requested tiers passed' : `qualification capped at ${highestPassingTier}`),
    tiers: tierResults,
    repoIntegrity: {
      baselineRepoTestsOk: baselineRepoTests.ok,
      finalRepoTestsOk: finalRepoTests.ok,
      finalSmokeOk: finalSmoke.ok
    },
    selectedTierArtifacts: runForArtifacts ? {
      selectedTier,
      runRoot: runForArtifacts.runRoot,
      selectedTierSupervisor: paths.selectedTierSupervisor,
      leaseState: paths.leaseState,
      patchQueueReport: paths.patchQueueReport,
      mergeReport: paths.mergeReport,
      recoveryReport: paths.recoveryReport
    } : null
  },
  provenCoordinationScaleTier: highestPassingTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  blocker: blockerReport,
  distinctionFromFixtureMode: 'Fixture qualification in /root/clawd/large-project-capability-stack is historical context only. This report covers live worker execution against the actual /root/clawd/mailchimp-clone repo.'
};
writeJson(paths.scaleQualification, scaleQualification);
if (blockerReport) writeJson(paths.blockerReport, blockerReport);

const realRepoSliceReady = shardPlan.summary.shardCount >= 120 && contextPacks.length === shardPlan.shards.length;
const repoIntegrityOk = PRODUCT_ONLY_MODE ? true : (baselineRepoTests.ok && finalRepoTests.ok && (highestPassingTier === null ? true : finalSmoke.ok) && validationIndex.perTierRepoTests.every((entry) => entry.ok || entry.tier > (highestPassingTier || 0)));
const liveExecutionOk = Boolean(selectedRun) && selectedRun.metrics.stateLossEvents === 0 && selectedRun.patchQueue.rejected.length === 0 && selectedRun.supervisor.topLevel.status === 'green';
const stagedLadderOk = highestPassingTier !== null && scaleQualification.realRepoLive.attemptedTiers[0] === 8;

if (PRODUCT_ONLY_MODE) {
  const mergedFocusIds = extractVerifiedFocusIdsFromPatchQueue(runForArtifacts?.patchQueue || { merged: [] });
  for (const issue of issueDefinitions()) {
    graph = setIssueStatus(
      graph,
      issue.id,
      mergedFocusIds.includes(issue.id) ? 'complete' : 'pending',
      mergedFocusIds.includes(issue.id) ? [paths.patchQueueReport, paths.mergeReport] : []
    );
  }
} else {
  if (realRepoSliceReady) graph = setIssueStatus(graph, 'q1.real_repo_parallel_slice', 'complete', [paths.workGraph, paths.shardPlan, paths.contextPacks]);
  else graph = setIssueStatus(graph, 'q1.real_repo_parallel_slice', 'blocked', [paths.workGraph, paths.shardPlan, paths.contextPacks]);

  if (liveExecutionOk) graph = setIssueStatus(graph, 'q2.live_worker_execution', 'complete', [paths.liveExecutionSummary, paths.leaseState, paths.patchQueueReport, paths.mergeReport, paths.recoveryReport]);
  else graph = setIssueStatus(graph, 'q2.live_worker_execution', blockerReport ? 'blocked' : 'pending', [paths.liveExecutionSummary, paths.leaseState, paths.patchQueueReport, paths.mergeReport, paths.recoveryReport]);

  if (stagedLadderOk) graph = setIssueStatus(graph, 'q3.staged_scale_ladder', 'complete', [paths.scaleQualification, paths.selectedTierSupervisor, paths.selectedTierSummary]);
  else graph = setIssueStatus(graph, 'q3.staged_scale_ladder', blockerReport ? 'blocked' : 'pending', [paths.scaleQualification]);

  if (repoIntegrityOk) graph = setIssueStatus(graph, 'q4.repo_integrity', 'complete', [paths.validationIndex, path.join(VALIDATION_DIR, 'baseline_repo_tests.log'), finalSmoke.logPath]);
  else graph = setIssueStatus(graph, 'q4.repo_integrity', blockerReport ? 'blocked' : 'pending', [paths.validationIndex, path.join(VALIDATION_DIR, 'baseline_repo_tests.log'), finalSmoke.logPath]);
}

writeJson(paths.programState, {
  generatedAt: new Date().toISOString(),
  supervisorStatus: 'pending',
  matrixStatus: 'pending',
  allComplete: false,
  provenCoordinationScaleTier: highestPassingTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  stopReason: scaleQualification.realRepoLive.stopReason
});
writeJson(paths.completionSummary, {
  generatedAt: new Date().toISOString(),
  supervisorConfirmedCompletion: false,
  supervisorStatus: 'pending',
  surfaceMatrixPath: paths.surfaceMatrix,
  surfaceMatrixStatus: 'pending',
  provenCoordinationScaleTier: highestPassingTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm'
});
writeJson(paths.notificationState, {
  delivered: false,
  deliveredAt: null,
  awaitingNotifier: false,
  supervisorStatus: 'pending',
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  provenCoordinationScaleTier: highestPassingTier
});
if (!PRODUCT_ONLY_MODE) graph = setIssueStatus(graph, 'q5.supervisor_state', 'complete', [paths.programState, paths.completionSummary, paths.notificationState, paths.supervisorStatus]);

saveGraph(paths.issueGraph, graph);
saveMatrix(paths.surfaceMatrix, compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() }));

const supervisorLog = path.join(VALIDATION_DIR, 'supervisor.log');
updateTierTrace({ stage: 'supervisor_start', highestPassingTier, supervisorLog, blockerReport });
const supervisorRun = runCommand(process.execPath, ['scripts/orchestrator-real-repo-clean-supervisor.mjs'], { cwd: ROOT, logPath: supervisorLog, allowFailure: true });
blockerReport = readJson(paths.blockerReport, blockerReport) || blockerReport;
if (!supervisorRun.ok && !blockerReport && PRODUCT_ONLY_MODE) {
  blockerReport = {
    blocker: 'No parity-surface reduction was proven by this iteration.',
    nextAction: 'Retarget the remaining red parity surfaces or emit a blocker/no-op report instead of repeating tier-100 qualification.',
    highestPassingTier,
    supervisorLog
  };
  writeJson(paths.blockerReport, blockerReport);
}
updateWorker(paths.campaignState, { id: 'qualification.supervisor', ok: supervisorRun.ok, logPath: supervisorLog });
completeWorkerIteration(paths.campaignState, {
  ok: supervisorRun.ok,
  note: supervisorRun.ok ? 'real repo orchestrator qualification supervisor green' : 'real repo orchestrator qualification ended with blocker or partial supervisor state',
  blockerReport,
  outcome: { supervisorLog, highestPassingTier, blockerReport }
});
updateTierTrace({ stage: 'supervisor_complete', highestPassingTier, supervisorRun, blockerReport });

let notifierRun = null;
if (supervisorRun.ok) {
  const notifierLog = path.join(VALIDATION_DIR, 'notifier.log');
  updateTierTrace({ stage: 'notifier_start', highestPassingTier, notifierLog });
  notifierRun = runCommand(process.execPath, ['scripts/orchestrator-real-repo-clean-notify.mjs'], { cwd: ROOT, logPath: notifierLog, allowFailure: true });
  updateWorker(paths.campaignState, { id: 'qualification.notifier', ok: notifierRun.ok, logPath: notifierLog });
  updateTierTrace({ stage: 'notifier_complete', highestPassingTier, notifierRun });
}

console.log(JSON.stringify({
  ok: supervisorRun.ok,
  artifactRoot: ARTIFACT_ROOT,
  highestPassingTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  blocker: blockerReport,
  supervisorLog,
  notifierOk: notifierRun?.ok ?? null
}, null, 2));
process.exit(supervisorRun.ok ? 0 : 1);
