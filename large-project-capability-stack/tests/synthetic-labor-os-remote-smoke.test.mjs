import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildJobClaimGate,
  buildLocalWorkerRun,
  compileJobContract,
  createArtifactBundleManifest,
  createCommandExecutionResult,
  createJob,
  createJobTestContract,
  createLocalExecutionPlan,
  createRemoteDispatchManifest,
  createWorkQueueArtifact,
  evaluateRemoteDispatchResult,
  queueJob,
  recordJobTestEvidence,
  transitionJob,
  verifyArtifactBundleManifest
} from '../packages/synthetic-labor-os/index.mjs';

test('Synthetic Labor OS remote smoke validates local-runner and remote-dispatch contracts without broader workspace dependencies', () => {
  const job = createJob({ id: 'slos-remote-smoke', objective: 'Remote execution smoke', requestedAgentCount: 1 });
  const testContract = createJobTestContract({ job, commands: ['node --version'] });
  const compiled = compileJobContract(job, { surfaces: ['remote_smoke_surface'] });
  const queue = createWorkQueueArtifact({ job: compiled, workItems: [{ id: 'remote-smoke-item', surfaceId: 'remote_smoke_surface', title: 'Remote smoke item' }] });
  const queued = queueJob({ ...compiled, artifacts: { ...compiled.artifacts, testContract } }, { queue });
  const executionPlan = createLocalExecutionPlan({ job: queued, testContract });
  const commandResult = createCommandExecutionResult({ command: 'node --version', exitCode: 0, stdout: 'v22.0.0\n', logPath: '/tmp/synthetic-labor-os-remote-smoke.log' });
  const workerRun = buildLocalWorkerRun({ job: queued, executionPlan, commandResults: [commandResult] });
  const withTests = recordJobTestEvidence(transitionJob(queued, { to: 'running' }), {
    testContract,
    testRuns: [{ command: commandResult.command, ok: true, exitCode: 0, artifactRef: commandResult.logPath }]
  });
  const claimGate = buildJobClaimGate({ job: withTests, workerRun, testEvidence: withTests.artifacts.testEvidence });
  const manifest = createRemoteDispatchManifest({
    job,
    localRepoPath: '/local/repo',
    localArtifactRoot: '/local/artifacts',
    remoteHost: 'jake@example.test',
    remoteRepoPath: '/remote/repo',
    remoteArtifactRoot: '/remote/artifacts',
    command: 'node --test tests/synthetic-labor-os-remote-smoke.test.mjs',
    codeSyncPaths: ['package.json', 'tests/synthetic-labor-os-remote-smoke.test.mjs']
  });
  const returnedArtifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-remote-return-'));
  fs.writeFileSync(path.join(returnedArtifacts, 'worker_run.json'), JSON.stringify(workerRun, null, 2));
  fs.writeFileSync(path.join(returnedArtifacts, 'claim_gate.json'), JSON.stringify(claimGate, null, 2));
  const artifactBundle = createArtifactBundleManifest({
    artifactRoot: returnedArtifacts,
    includePaths: ['worker_run.json', 'claim_gate.json'],
    label: 'remote-smoke-returned-artifacts',
    createdBy: 'remote-smoke-test'
  });
  fs.writeFileSync(path.join(returnedArtifacts, 'artifact_bundle_manifest.json'), JSON.stringify(artifactBundle, null, 2));
  const artifactIntegrity = verifyArtifactBundleManifest({ artifactRoot: returnedArtifacts, manifest: artifactBundle });
  const result = evaluateRemoteDispatchResult({
    manifest,
    syncProof: { matched: true },
    remoteRun: { exitCode: 0, runnerPayload: { ok: true, jobId: job.id, claimGate: { thresholdPass: true } } },
    runnerPayload: { ok: true, jobId: job.id, claimGate: { thresholdPass: true } },
    artifactReturn: { returned: true },
    artifactIntegrity
  });

  assert.equal(executionPlan.ok, true);
  assert.equal(workerRun.ok, true);
  assert.equal(claimGate.completionClaimAllowed, true);
  assert.equal(manifest.okToLaunch, true);
  assert.equal(artifactBundle.summary.ok, true);
  assert.equal(artifactIntegrity.ok, true);
  assert.equal(result.ok, true);
  assert.equal(result.completionSummary.artifactBundleVerified, true);
  assert.equal(result.completionSummary.thresholdPass, true);
});
