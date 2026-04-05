import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compileTaskContract, saveContract } from '../../large-project-capability-stack/packages/task-contract/index.mjs';
import { createIssueGraph, upsertIssue, linkDependency, saveGraph, setIssueStatus, loadGraph } from '../../large-project-capability-stack/packages/issue-dag/index.mjs';
import { compileSurfaceMatrix, saveMatrix } from '../../large-project-capability-stack/packages/surface-matrix/index.mjs';
import { initializeCampaign, recoverCampaign, claimWorkerIteration, updateWorker, completeWorkerIteration } from '../../large-project-capability-stack/packages/campaign-runtime/index.mjs';
import { ROOT, ensureDirs, paths, TARGET_LOC, contractInput, issueDefinitions, surfaceDefinitions, measureLoc, readJson, writeJson } from './lib/loc-500k-campaign-plan.mjs';

function run(command, args, { cwd = ROOT, logPath, allowFailure = false, env = process.env } = {}) {
  const startedAt = Date.now();
  const rendered = [command, ...args].join(' ');
  try {
    const output = execFileSync(command, args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
    if (logPath) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, output);
    }
    return { ok: true, command: rendered, output, logPath, durationMs: Date.now() - startedAt };
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}${error.message || ''}`;
    if (logPath) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.writeFileSync(logPath, output);
    }
    if (!allowFailure) throw error;
    return { ok: false, command: rendered, output, logPath, durationMs: Date.now() - startedAt };
  }
}

function appendLocSnapshot(locProgress, label, extra = {}) {
  const snapshot = { label, ...measureLoc(), ...extra };
  locProgress.snapshots.push(snapshot);
  locProgress.current = snapshot;
  locProgress.locTargetMet = snapshot.locTargetMet;
  locProgress.updatedAt = new Date().toISOString();
  writeJson(paths.locProgress, locProgress);
  return snapshot;
}

ensureDirs();

const contract = saveContract(paths.contract, compileTaskContract(contractInput()));
let graph = createIssueGraph({ title: 'mailchimp-loc-500k-campaign', targetPath: ROOT });
for (const issue of issueDefinitions()) graph = upsertIssue(graph, { status: 'pending', owner: 'campaign', ...issue });
for (const issue of issueDefinitions()) for (const dep of issue.deps || []) graph = linkDependency(graph, issue.id, dep);
saveGraph(paths.graph, graph);
saveMatrix(paths.matrix, compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() }));

initializeCampaign(paths.campaign, {
  mode: 'persistent',
  stopCondition: 'loc_gte_500k_or_blocker_report',
  contractPath: paths.contract,
  graphPath: paths.graph,
  matrixPath: paths.matrix
});
recoverCampaign(paths.campaign);
claimWorkerIteration(paths.campaign, {
  claimedBy: 'scripts/loc-500k-campaign.mjs',
  reason: 'loc_500k_mailchimp_expansion_campaign'
});
updateWorker(paths.campaign, { id: 'loc500k.start', ok: true, note: 'starting persistent loc >= 500k campaign' });

const locProgress = writeJson(paths.locProgress, {
  generatedAt: new Date().toISOString(),
  targetTotal: TARGET_LOC,
  snapshots: [],
  current: null,
  locTargetMet: false
});
appendLocSnapshot(locProgress, 'initial');
updateWorker(paths.campaign, { id: 'loc500k.initial-snapshot', ok: true, total: locProgress.current.total });

graph = setIssueStatus(graph, 'loc500k.bootstrap', 'complete', [paths.contract, paths.graph, paths.matrix, paths.locProgress]);
saveGraph(paths.graph, graph);
saveMatrix(paths.matrix, compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() }));

const generationTargets = [540, 620, 700];
let generatorOk = false;
for (const target of generationTargets) {
  if (locProgress.current.total >= TARGET_LOC) {
    generatorOk = true;
    break;
  }
  const logPath = target === 540 ? paths.generatorLog540 : target === 620 ? paths.generatorLog620 : paths.generatorLog700;
  const result = run(process.execPath, ['scripts/generate-loc-500k-expansion.mjs', '--target-packages', String(target)], { cwd: ROOT, logPath, allowFailure: true });
  updateWorker(paths.campaign, { id: `loc500k.generate.${target}`, ok: result.ok, logPath, durationMs: result.durationMs });
  appendLocSnapshot(locProgress, `post-generate-${target}`, { generatorTarget: target, generatorOk: result.ok, generatorLog: logPath });
  if (!result.ok) {
    generatorOk = false;
    break;
  }
  if (locProgress.current.total >= TARGET_LOC) {
    generatorOk = true;
    break;
  }
}

let blocker = null;
if (!generatorOk || locProgress.current.total < TARGET_LOC) {
  blocker = writeJson(paths.blocker, {
    generatedAt: new Date().toISOString(),
    blocker: !generatorOk ? 'Generator run failed before the repo reached the loc threshold.' : `Repo still below ${TARGET_LOC} LOC after the configured expansion passes.`,
    nextAction: !generatorOk ? 'Inspect generator logs and repair the generation script.' : 'Raise the generator target and continue the campaign with additional package families.',
    latestSnapshot: locProgress.current
  });
}

const validationState = {
  generatedAt: new Date().toISOString(),
  generatorOk,
  repoTestsOk: false,
  smokeOk: false,
  browserOk: false,
  orchestratorOk: false,
  truthRefreshOk: false,
  logs: {
    npmTest: paths.npmTestLog,
    smoke: paths.smokeLog,
    browser: paths.browserLog,
    orchestrator: paths.orchestratorLog,
    truthRefresh: paths.truthRefreshLog
  }
};

if (!blocker) {
  const repoTests = run('npm', ['test'], { cwd: ROOT, logPath: paths.npmTestLog, allowFailure: true });
  validationState.repoTestsOk = repoTests.ok;
  updateWorker(paths.campaign, { id: 'loc500k.repo-tests', ok: repoTests.ok, logPath: paths.npmTestLog, durationMs: repoTests.durationMs });

  const smoke = run(process.execPath, ['scripts/smoke-full-clone.mjs'], { cwd: ROOT, logPath: paths.smokeLog, allowFailure: true });
  validationState.smokeOk = smoke.ok;
  updateWorker(paths.campaign, { id: 'loc500k.smoke', ok: smoke.ok, logPath: paths.smokeLog, durationMs: smoke.durationMs });

  const browser = run('npm', ['run', 'wave1:browser-proof'], { cwd: ROOT, logPath: paths.browserLog, allowFailure: true });
  validationState.browserOk = browser.ok;
  updateWorker(paths.campaign, { id: 'loc500k.browser-proof', ok: browser.ok, logPath: paths.browserLog, durationMs: browser.durationMs });

  const orchestrator = run(process.execPath, ['scripts/orchestrator-real-repo-run.mjs'], { cwd: ROOT, logPath: paths.orchestratorLog, allowFailure: true });
  const orchestratorSupervisor = readJson(paths.orchestratorSupervisor, null);
  validationState.orchestratorOk = orchestrator.ok && orchestratorSupervisor?.supervisorStatus === 'green';
  updateWorker(paths.campaign, { id: 'loc500k.orchestrator', ok: validationState.orchestratorOk, logPath: paths.orchestratorLog, durationMs: orchestrator.durationMs });

  const truthRefresh = run(process.execPath, ['scripts/refresh-top-tier-truth-local.mjs'], { cwd: ROOT, logPath: paths.truthRefreshLog, allowFailure: true });
  validationState.truthRefreshOk = truthRefresh.ok;
  updateWorker(paths.campaign, { id: 'loc500k.truth-refresh', ok: truthRefresh.ok, logPath: paths.truthRefreshLog, durationMs: truthRefresh.durationMs });

  appendLocSnapshot(locProgress, 'post-validation', {
    repoTestsOk: validationState.repoTestsOk,
    smokeOk: validationState.smokeOk,
    browserOk: validationState.browserOk,
    orchestratorOk: validationState.orchestratorOk,
    truthRefreshOk: validationState.truthRefreshOk
  });

  if (!validationState.repoTestsOk || !validationState.smokeOk || !validationState.browserOk || !validationState.orchestratorOk || !validationState.truthRefreshOk) {
    blocker = writeJson(paths.blocker, {
      generatedAt: new Date().toISOString(),
      blocker: !validationState.repoTestsOk
        ? 'Repo-wide tests failed after expansion.'
        : !validationState.smokeOk
          ? 'Live smoke validation failed after expansion.'
          : !validationState.browserOk
            ? 'Browser proof failed after expansion.'
            : !validationState.orchestratorOk
              ? 'Real repo orchestrator rerun did not stay green on the enlarged repo.'
              : 'Truth refresh failed after expansion.',
      nextAction: 'Inspect the validation logs under the campaign validation directory and repair the failing surface before continuing.',
      latestSnapshot: locProgress.current,
      validationState
    });
  }
}

writeJson(paths.validationState, validationState);

graph = loadGraph(paths.graph);
if (generatorOk) graph = setIssueStatus(graph, 'loc500k.massive_package_growth', 'complete', [
  'scripts/generate-loc-500k-expansion.mjs',
  'packages/scale-wave-seven/index.mjs',
  'packages/acquisition-advisor/index.mjs',
  'packages/trust-watchtower/index.mjs'
]);
else graph = setIssueStatus(graph, 'loc500k.massive_package_growth', 'blocked', [paths.locProgress, paths.generatorLog540, paths.generatorLog620, paths.generatorLog700]);

const mainAppSurfaceOk = fs.existsSync('packages/app/routes/scale-wave-seven.mjs') && fs.readFileSync('apps/web/server.mjs', 'utf8').includes("registerScaleWaveSevenRoutes") && validationState.repoTestsOk;
const auxiliaryAppsOk = ['growth-grid', 'revenue-command', 'trust-vault', 'intelligence-works', 'lifecycle-network'].every((id) => fs.existsSync(`apps/${id}/server.mjs`)) && validationState.repoTestsOk;
const locThresholdOk = locProgress.current.total >= TARGET_LOC;
const repoValidationOk = validationState.repoTestsOk && validationState.smokeOk && validationState.browserOk;
const orchestratorOk = validationState.orchestratorOk;
const truthRefreshOk = validationState.truthRefreshOk;

graph = setIssueStatus(graph, 'loc500k.main_app_surface', mainAppSurfaceOk ? 'complete' : blocker ? 'blocked' : 'pending', ['packages/app/routes/scale-wave-seven.mjs', 'apps/web/server.mjs', 'tests/scale-wave-seven.test.mjs']);
graph = setIssueStatus(graph, 'loc500k.auxiliary_apps', auxiliaryAppsOk ? 'complete' : blocker ? 'blocked' : 'pending', ['apps/growth-grid/server.mjs', 'apps/revenue-command/server.mjs', 'apps/trust-vault/server.mjs', 'apps/intelligence-works/server.mjs', 'apps/lifecycle-network/server.mjs']);
graph = setIssueStatus(graph, 'loc500k.loc_threshold', locThresholdOk ? 'complete' : blocker ? 'blocked' : 'pending', [paths.locProgress]);
graph = setIssueStatus(graph, 'loc500k.repo_validation', repoValidationOk ? 'complete' : blocker ? 'blocked' : 'pending', [paths.npmTestLog, paths.smokeLog, paths.browserLog, paths.validationState]);
graph = setIssueStatus(graph, 'loc500k.orchestrator', orchestratorOk ? 'complete' : blocker ? 'blocked' : 'pending', [paths.orchestratorSummary, paths.orchestratorSupervisor, paths.orchestratorLog]);
graph = setIssueStatus(graph, 'loc500k.truth_refresh', truthRefreshOk ? 'complete' : blocker ? 'blocked' : 'pending', [paths.truthCertification, paths.pathGap, paths.pathSummary, paths.truthRefreshLog]);

saveGraph(paths.graph, graph);
const matrix = compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() });
saveMatrix(paths.matrix, matrix);

const supervisorRun = run(process.execPath, ['scripts/loc-500k-supervisor.mjs'], { cwd: ROOT, logPath: paths.supervisor.replace(/\.json$/, '.log'), allowFailure: true });
const supervisor = readJson(paths.supervisor, { status: 'red', surfaceMatrixStatus: matrix.status, blocker });
const truthCertification = readJson(paths.truthCertification, null);
const pathGap = readJson(paths.pathGap, null);

const finalStatus = supervisor.status;
writeJson(paths.programState, {
  generatedAt: new Date().toISOString(),
  supervisorStatus: finalStatus,
  matrixStatus: supervisor.surfaceMatrixStatus || matrix.status,
  locSnapshot: locProgress.current,
  truthGateCurrentClaim: truthCertification?.highestAllowedClaim || null,
  truthGateRequestedClaimAllowed: truthCertification?.requestedClaimAllowed ?? null,
  topTierEligible: pathGap?.summary?.eligibleForTargetClaim ?? null,
  stopCondition: 'loc_gte_500k_or_blocker_report'
});
writeJson(paths.notificationState, {
  delivered: false,
  deliveredAt: null,
  supervisorStatus: finalStatus,
  locTargetMet: locProgress.current.total >= TARGET_LOC,
  campaignMode: 'persistent'
});
writeJson(paths.completionSummary, {
  generatedAt: new Date().toISOString(),
  replyAnchor: contract.replyAnchor,
  anchor: contract.anchor,
  targetPath: ROOT,
  fidelity: 'full_clone',
  scope: 'LOC >= 500k Mailchimp expansion campaign',
  stopCondition: 'loc_gte_500k_or_blocker_report',
  campaignMode: 'persistent',
  supervisorStatus: finalStatus,
  surfaceMatrix: paths.matrix,
  surfaceMatrixStatus: supervisor.surfaceMatrixStatus || matrix.status,
  locSnapshot: locProgress.current,
  validationState,
  truthGateCurrentClaim: truthCertification?.highestAllowedClaim || null,
  truthGateRequestedClaimAllowed: truthCertification?.requestedClaimAllowed ?? null,
  topTierEligible: pathGap?.summary?.eligibleForTargetClaim ?? null,
  blockerReport: blocker ? paths.blocker : null,
  campaignRequestedClaimAllowed: finalStatus === 'green'
});

graph = loadGraph(paths.graph);
graph = setIssueStatus(graph, 'loc500k.supervision', fs.existsSync(paths.programState) && fs.existsSync(paths.completionSummary) && fs.existsSync(paths.notificationState) && fs.existsSync(paths.supervisor) ? 'complete' : 'blocked', [paths.programState, paths.completionSummary, paths.notificationState, paths.supervisor, paths.blocker]);
saveGraph(paths.graph, graph);
saveMatrix(paths.matrix, compileSurfaceMatrix({ contract, graph, surfaces: surfaceDefinitions() }));

updateWorker(paths.campaign, { id: 'loc500k.supervisor', ok: finalStatus === 'green', logPath: paths.supervisor.replace(/\.json$/, '.log'), total: locProgress.current.total, matrixStatus: supervisor.surfaceMatrixStatus || matrix.status });
completeWorkerIteration(paths.campaign, {
  ok: finalStatus === 'green',
  note: finalStatus === 'green' ? 'loc 500k campaign completed with supervisor-green proof' : 'loc 500k campaign ended with blocker report',
  outcome: { supervisorStatus: finalStatus, total: locProgress.current.total, blocker }
});

console.log(JSON.stringify({
  ok: finalStatus === 'green',
  artifactRoot: 'artifacts/mailchimp_clone/real_world_indistinguishable/loc_500k_campaign',
  supervisorStatus: finalStatus,
  total: locProgress.current.total,
  matrixStatus: readJson(paths.supervisor, {}).surfaceMatrixStatus || matrix.status,
  blocker
}, null, 2));
process.exit(finalStatus === 'green' ? 0 : 1);
