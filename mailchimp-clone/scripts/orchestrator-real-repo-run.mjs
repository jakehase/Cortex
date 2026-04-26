import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compileTaskContract, saveContract } from '../../large-project-capability-stack/packages/task-contract/index.mjs';
import { createIssueGraph, upsertIssue, linkDependency, saveGraph, setIssueStatus } from '../../large-project-capability-stack/packages/issue-dag/index.mjs';
import { compileSurfaceMatrix, saveMatrix } from '../../large-project-capability-stack/packages/surface-matrix/index.mjs';
import { initializeCampaign, recoverCampaign, claimWorkerIteration, updateWorker, completeWorkerIteration } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { buildShardPlan, createArtifactBus, compileContextPacks, runLiveWorkerFarm, saveJson } from '../../large-project-capability-stack/packages/multi-agent-orchestrator/index.mjs';
import {
  ROOT,
  ARTIFACT_ROOT,
  VALIDATION_DIR,
  WORKER_SCRIPT,
  VERIFIER_SCRIPT,
  STACK_FIXTURE_SCALE_PATH,
  paths,
  ensureDirs,
  contractInput,
  issueDefinitions,
  surfaceDefinitions,
  buildRealRepoWorkGraph,
  buildFailurePlan,
  buildVerifierCatalog,
  tierRunDir,
  readJson,
  writeJson
} from './lib/orchestrator-real-repo-plan.mjs';

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

ensureDirs();

const contract = saveContract(paths.contract, compileTaskContract(contractInput()));
let graph = createIssueGraph({ title: 'mailchimp-real-repo-orchestrator-qualification', targetPath: ROOT });
for (const issue of issueDefinitions()) graph = upsertIssue(graph, { status: 'pending', owner: 'orchestrator', ...issue });
for (const issue of issueDefinitions()) {
  for (const dep of issue.deps || []) graph = linkDependency(graph, issue.id, dep);
}
saveGraph(paths.issueGraph, graph);
saveMatrix(paths.surfaceMatrix, compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() }));

initializeCampaign(paths.campaignState, {
  mode: 'persistent',
  stopCondition: 'supervisor_green_or_blocker_report',
  contractPath: paths.contract,
  graphPath: paths.issueGraph,
  matrixPath: paths.surfaceMatrix
});
recoverCampaign(paths.campaignState);
claimWorkerIteration(paths.campaignState, {
  claimedBy: 'scripts/orchestrator-real-repo-run.mjs',
  reason: 'real_mailchimp_repo_orchestrator_qualification'
});
updateWorker(paths.campaignState, { id: 'qualification.start', ok: true, note: 'starting staged live qualification on the real Mailchimp repo' });

const fixtureBaseline = readJson(STACK_FIXTURE_SCALE_PATH, null);
const seed = buildRealRepoWorkGraph();
writeJson(paths.workGraph, seed.workGraph);
writeJson(paths.workSurfaceMatrix, seed.surfaceMatrix);
writeJson(paths.verifierCatalog, buildVerifierCatalog());

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

const baselineLog = path.join(VALIDATION_DIR, 'baseline_repo_tests.log');
const baselineRepoTests = runCommand('npm', ['test', '--', '--runInBand'], { cwd: ROOT, logPath: baselineLog, allowFailure: true });
validationIndex.baseline = { ok: baselineRepoTests.ok, command: baselineRepoTests.command, logPath: baselineLog, durationMs: baselineRepoTests.durationMs };
writeJson(paths.validationIndex, validationIndex);
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

const tiers = [8, 16, 32, 64, 100];
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
  const liveRun = await runLiveWorkerFarm({
    workGraph: seed.workGraph,
    surfaceMatrix: seed.surfaceMatrix,
    agentCount: tier,
    workerScriptPath: WORKER_SCRIPT,
    verifierScriptPath: VERIFIER_SCRIPT,
    workspacePath: ROOT,
    runRoot: tierRunDir(tier),
    campaignContract: contract,
    leaseTtlMs,
    maxRuntimeMs: 300000,
    pollMs: 50,
    plannerOptions: {
      maxFileAreasPerShard: 8,
      maxFilesPerShard: 128,
      maxAcceptanceChecksPerShard: 8
    },
    failureInjections: failurePlan,
    globalInputs: seed.globalInputs,
    executionMode: 'real_mailchimp_repo_live_worker_farm'
  });
  lastAttemptedRun = liveRun;

  const repoTestLog = path.join(VALIDATION_DIR, `tier-${String(tier).padStart(3, '0')}_repo_tests.log`);
  const repoTests = runCommand('npm', ['test', '--', '--runInBand'], { cwd: ROOT, logPath: repoTestLog, allowFailure: true });
  validationIndex.perTierRepoTests.push({ tier, ok: repoTests.ok, command: repoTests.command, logPath: repoTestLog, durationMs: repoTests.durationMs });
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

let finalSmoke = { ok: false, command: 'node scripts/smoke-full-clone.mjs', logPath: path.join(VALIDATION_DIR, 'final_smoke.log'), durationMs: 0 };
if (highestPassingTier !== null) {
  finalSmoke = runCommand(process.execPath, ['scripts/smoke-full-clone.mjs'], { cwd: ROOT, logPath: finalSmoke.logPath, allowFailure: true });
}
validationIndex.finalSmoke = { ok: finalSmoke.ok, command: finalSmoke.command, logPath: finalSmoke.logPath, durationMs: finalSmoke.durationMs };

const finalRepoLog = path.join(VALIDATION_DIR, 'final_repo_tests.log');
const finalRepoTests = runCommand('npm', ['test', '--', '--runInBand'], { cwd: ROOT, logPath: finalRepoLog, allowFailure: true });
validationIndex.finalRepoTests = { ok: finalRepoTests.ok, command: finalRepoTests.command, logPath: finalRepoLog, durationMs: finalRepoTests.durationMs };
writeJson(paths.validationIndex, validationIndex);

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
const repoIntegrityOk = baselineRepoTests.ok && finalRepoTests.ok && (highestPassingTier === null ? true : finalSmoke.ok) && validationIndex.perTierRepoTests.every((entry) => entry.ok || entry.tier > (highestPassingTier || 0));
const liveExecutionOk = Boolean(selectedRun) && selectedRun.metrics.stateLossEvents === 0 && selectedRun.patchQueue.rejected.length === 0 && selectedRun.supervisor.topLevel.status === 'green';
const stagedLadderOk = highestPassingTier !== null && scaleQualification.realRepoLive.attemptedTiers[0] === 8;

if (realRepoSliceReady) graph = setIssueStatus(graph, 'q1.real_repo_parallel_slice', 'complete', [paths.workGraph, paths.shardPlan, paths.contextPacks]);
else graph = setIssueStatus(graph, 'q1.real_repo_parallel_slice', 'blocked', [paths.workGraph, paths.shardPlan, paths.contextPacks]);

if (liveExecutionOk) graph = setIssueStatus(graph, 'q2.live_worker_execution', 'complete', [paths.liveExecutionSummary, paths.leaseState, paths.patchQueueReport, paths.mergeReport, paths.recoveryReport]);
else graph = setIssueStatus(graph, 'q2.live_worker_execution', blockerReport ? 'blocked' : 'pending', [paths.liveExecutionSummary, paths.leaseState, paths.patchQueueReport, paths.mergeReport, paths.recoveryReport]);

if (stagedLadderOk) graph = setIssueStatus(graph, 'q3.staged_scale_ladder', 'complete', [paths.scaleQualification, paths.selectedTierSupervisor, paths.selectedTierSummary]);
else graph = setIssueStatus(graph, 'q3.staged_scale_ladder', blockerReport ? 'blocked' : 'pending', [paths.scaleQualification]);

if (repoIntegrityOk) graph = setIssueStatus(graph, 'q4.repo_integrity', 'complete', [paths.validationIndex, path.join(VALIDATION_DIR, 'baseline_repo_tests.log'), finalSmoke.logPath]);
else graph = setIssueStatus(graph, 'q4.repo_integrity', blockerReport ? 'blocked' : 'pending', [paths.validationIndex, path.join(VALIDATION_DIR, 'baseline_repo_tests.log'), finalSmoke.logPath]);

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
graph = setIssueStatus(graph, 'q5.supervisor_state', 'complete', [paths.programState, paths.completionSummary, paths.notificationState, paths.supervisorStatus]);

saveGraph(paths.issueGraph, graph);
saveMatrix(paths.surfaceMatrix, compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() }));

const supervisorLog = path.join(VALIDATION_DIR, 'supervisor.log');
const supervisorRun = runCommand(process.execPath, ['scripts/orchestrator-real-repo-supervisor.mjs'], { cwd: ROOT, logPath: supervisorLog, allowFailure: true });
updateWorker(paths.campaignState, { id: 'qualification.supervisor', ok: supervisorRun.ok, logPath: supervisorLog });
completeWorkerIteration(paths.campaignState, {
  ok: supervisorRun.ok,
  note: supervisorRun.ok ? 'real repo orchestrator qualification supervisor green' : 'real repo orchestrator qualification ended with blocker or partial supervisor state',
  outcome: { supervisorLog, highestPassingTier, blockerReport }
});

console.log(JSON.stringify({
  ok: supervisorRun.ok,
  artifactRoot: ARTIFACT_ROOT,
  highestPassingTier,
  qualificationMode: 'real_mailchimp_repo_live_worker_farm',
  blocker: blockerReport,
  supervisorLog
}, null, 2));
process.exit(supervisorRun.ok ? 0 : 1);
