import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  admitHundredAgentScaleProof,
  approvePatch,
  buildJobClaimGate,
  buildAgentStatusRecords,
  buildCleanV0DemoProof,
  buildLocalWorkerRun,
  buildOperatorDashboard,
  buildPatchQueueStatus,
  buildReleasePacket,
  buildRunLedger,
  buildSyntheticLaborOsAudit,
  buildSyntheticLaborOsCapabilityMatrix,
  compileJobContract,
  createArtifactBundleManifest,
  createCommandExecutionResult,
  createExecutionPlaneRegistry,
  createImprovementProposal,
  createJob,
  createJobIntakeContract,
  createJobTestContract,
  createLocalExecutionPlan,
  createRemoteDispatchManifest,
  createWorkQueueArtifact,
  deriveJobTruth,
  evaluateExecutionPlaneReadiness,
  evaluateImprovementProposal,
  evaluateRemoteDispatchResult,
  pauseJob,
  queueJob,
  recordJobTestEvidence,
  rejectPatch,
  renderSyntheticLaborOsAuditMarkdown,
  renderOperatorDashboardMarkdown,
  renderReleasePacketMarkdown,
  requestHumanReview,
  resumeJob,
  summarizeJobReviews,
  summarizeSyntheticLaborOsCapabilityMatrix,
  transitionJob,
  writeCleanV0DemoProof,
  verifyArtifactBundleManifest,
  writeSyntheticLaborOsJob,
  writeHundredAgentScaleProof
} from '../packages/synthetic-labor-os/index.mjs';
import {
  buildV20HardDogfoodDependencyManifest,
  buildV20ReleaseCandidatePacket,
  renderV20ReleaseCandidateMarkdown,
  summarizeHardEvidenceLog
} from '../apps/synthetic-labor-os/v20-hard-dogfood-rc.mjs';

const WORKSPACE_ROOT = path.resolve('..');

function writeJsonFixture(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function createV18LedgerFixture(temp) {
  const diffPaths = [
    'apps/synthetic-labor-os/local-runner.mjs',
    'apps/synthetic-labor-os/remote-dispatcher.mjs',
    'packages/synthetic-labor-os/index.mjs',
    'tests/synthetic-labor-os.test.mjs'
  ];
  const patchPath = path.join(temp, 'workspace/apps/synthetic-labor-os-v18/candidate_08/whole_os_candidate.patch');
  fs.mkdirSync(path.dirname(patchPath), { recursive: true });
  fs.writeFileSync(patchPath, [
    'diff --git a/packages/synthetic-labor-os/index.mjs b/packages/synthetic-labor-os/index.mjs',
    '--- a/packages/synthetic-labor-os/index.mjs',
    '+++ b/packages/synthetic-labor-os/index.mjs',
    '@@ -1 +1,2 @@',
    ' export const fixture = true;',
    '+export const ledgerFixture = true;'
  ].join('\n') + '\n');
  const patchSha256 = crypto.createHash('sha256').update(fs.readFileSync(patchPath)).digest('hex');
  const remoteSummaryPath = writeJsonFixture(path.join(temp, 'v18_whole_os_tournament_remote_summary.json'), {
    schemaVersion: 'claw.synthetic_labor_os.v18.whole_os_tournament_remote_summary',
    wholeOsTournamentGreen: true,
    mechanicalGreen: true,
    executionCoverageGreen: true,
    thresholdPass: false,
    candidateCount: 20,
    agentCount: 100,
    shardCount: 100,
    mergedShardCount: 100,
    observedAgentCount: 100,
    realCodexResultCount: 100,
    failedResultShardCount: 0,
    workerSpawnCount: 100,
    peakConcurrentWorkers: 20,
    winner: { id: 'candidate_08', title: 'Portable artifact bundle manifests with checksum verification', theme: 'artifact bundle portability and checksums', score: 100, patchPath, diffPaths, runtimePaths: diffPaths.slice(0, 3), testPaths: ['tests/synthetic-labor-os.test.mjs'] }
  });
  const proposalProofPath = writeJsonFixture(path.join(temp, 'v18_winner_proposal_proof.json'), { schemaVersion: 'claw.synthetic_labor_os.v18.winner_proposal_proof', ok: true, reviewReady: true, patchApplied: false, patchSha256 });
  const proposalSummaryPath = writeJsonFixture(path.join(temp, 'v18_winner_proposal_summary.json'), { schemaVersion: 'claw.synthetic_labor_os.v18.winner_proposal_summary', ok: true, patchProposalProofOk: true, reviewReady: true, patchApplied: false, returnedPatchProofPath: proposalProofPath, selectedCandidate: 'candidate_08', selectedScore: 100 });
  const approvalPath = writeJsonFixture(path.join(temp, 'winner_operator_approval.json'), { schemaVersion: 'claw.synthetic_labor_os.v5.patch_apply_approval', approved: true, actor: 'Jake', patchPath, patchSha256, approvedTargets: diffPaths, approvedActions: ['git_apply_selected_whole_os_winner_to_local_worktree', 'run_validation'], prohibitedActions: ['merge', 'publish', 'deploy', 'external_send'] });
  const applyGateProofPath = writeJsonFixture(path.join(temp, 'patch_apply_gate_proof.json'), { schemaVersion: 'claw.synthetic_labor_os.v5.patch_apply_gate_proof', ok: true, validationOk: true, patchApplied: true });
  const applyGateSummaryPath = writeJsonFixture(path.join(temp, 'v5_patch_apply_gate_summary.json'), { schemaVersion: 'claw.synthetic_labor_os.v5.patch_apply_gate_summary', ok: true, patchApplied: true, implementationClaimAllowedForApprovedPatch: true, patchSha256, diffPaths, changedTargets: diffPaths, proofPath: applyGateProofPath });
  const applySummaryPath = writeJsonFixture(path.join(temp, 'v18_winner_apply_summary.json'), { schemaVersion: 'claw.synthetic_labor_os.v18.winner_apply_summary', ok: true, gateExitCode: 0, patchApplied: true, implementationClaimAllowedForApprovedPatch: true, patchPath, patchSha256, approvalPath, summaryPath: applyGateSummaryPath, proofPath: applyGateProofPath, changedTargets: diffPaths, selectedCandidate: 'candidate_08', selectedScore: 100 });
  const chainPath = writeJsonFixture(path.join(temp, 'v6_provenance_chain.json'), { schemaVersion: 'claw.synthetic_labor_os.v6.provenance_chain', ok: true, patchSha256, artifacts: {} });
  const chainSummaryPath = writeJsonFixture(path.join(temp, 'v6_provenance_chain_summary.json'), { schemaVersion: 'claw.synthetic_labor_os.v6.provenance_chain_summary', ok: true, status: 'green_for_approved_patch_chain', chainPath, patchSha256, proposalOk: true, approvalOk: true, applyOk: true, validationOk: true, targetFiles: diffPaths, changedTargets: diffPaths });
  const runSummaryPath = writeJsonFixture(path.join(temp, 'v18_whole_os_tournament_summary.json'), {
    schemaVersion: 'claw.synthetic_labor_os.v18.whole_os_tournament_summary',
    ok: true,
    status: 'green_whole_slos_variant_winner_selected',
    jobId: 'slos-v18-whole-os-tournament-fixture',
    requestedCandidateCount: 20,
    requestedRoleAgentCount: 100,
    remoteSummaryPath,
    remoteWholeOsTournamentGreen: true,
    observedAgentCount: 100,
    realCodexResultCount: 100,
    mergedShardCount: 100,
    peakConcurrentWorkers: 20,
    selectedCandidate: { id: 'candidate_08', title: 'Portable artifact bundle manifests with checksum verification', theme: 'artifact bundle portability and checksums', score: 100, patchPath, diffPaths, runtimePaths: diffPaths.slice(0, 3), testPaths: ['tests/synthetic-labor-os.test.mjs'] },
    proposalSummaryPath,
    applySummaryPath,
    chainSummaryPath,
    chainPath,
    approvalPath,
    winnerPatchApplied: true,
    truthBoundary: 'fixture only; no merge, publish, deploy, or external send'
  });
  const priorArtGatePath = writeJsonFixture(path.join(temp, 'prior_art_gate.json'), {
    schemaVersion: 'cortex.memory.prior_art_gate.v1',
    ok: true,
    status: 'green_prior_art_gate',
    objective: 'Implement SLOS v19 as adapter over existing proof ledger primitives',
    proposedAction: 'adapter_wrapper_only',
    decision: 'adapter_wrapper_only',
    requiredAction: 'adapter_wrapper_only',
    sourceCoverage: { memoryResultCount: 2, structuralResultCount: 1, fileResultCount: 1, matchCount: 4, highConfidenceMatchCount: 3 },
    highConfidencePriorArt: [
      { source: 'durable_memory', label: 'memory/projects/100-agent-orchestration.md', score: 0.91 },
      { source: 'structural_code_graph', label: 'buildProofCarryingClaimLedger', score: 0.88 },
      { source: 'workspace_file', label: 'apps/synthetic-labor-os/v11-release-bundle.mjs', score: 0.79 }
    ],
    priorArtMatches: [],
    failures: [],
    warnings: ['prior_art_found_action_scoped_to_existing_capability'],
    truthBoundary: 'fixture prior-art gate only'
  });
  return { runSummaryPath, patchSha256, diffPaths, priorArtGatePath };
}

test('Synthetic Labor OS audit separates product shell readiness from missing proof artifacts', () => {
  const audit = buildSyntheticLaborOsAudit({
    workspaceRoot: WORKSPACE_ROOT,
    exists: (absolutePath, item) => item.path?.includes('artifacts/synthetic-labor-os-v0/latest/')
      ? false
      : fs.existsSync(absolutePath)
  });

  assert.equal(audit.summary.v0ProductReady, false);
  assert.ok(audit.summary.byPrimitiveStatus.implemented > 0);
  assert.ok(audit.summary.alreadyImplementedPrimitiveIds.includes('agent_work_contract_compilation'));
  assert.ok(audit.summary.alreadyImplementedPrimitiveIds.includes('truth_claim_landing_and_terminal_artifacts'));
  assert.ok(audit.summary.alreadyImplementedPrimitiveIds.includes('human_interrupt_review_and_approval_console'));
  assert.ok(audit.summary.alreadyImplementedPrimitiveIds.includes('documentation_and_test_contracts'));
  assert.ok(audit.summary.alreadyImplementedPrimitiveIds.includes('bounded_self_improvement_loop'));
  assert.ok(audit.summary.missingProductIds.includes('clean_v0_demo_proof'));
  assert.ok(audit.summary.missingProductIds.includes('hundred_agent_long_running_productive_proof'));
  assert.match(audit.summary.honestClaim, /not as a cohesive finished product|not product-ready/);
});

test('Synthetic Labor OS matrix keeps primitive and product status separate while recognizing OS shell surfaces', () => {
  const matrix = buildSyntheticLaborOsCapabilityMatrix({ workspaceRoot: WORKSPACE_ROOT });
  const handoff = matrix.rows.find((row) => row.id === 'objective_intake_to_agent_work_handoff');
  const productLifecycle = matrix.rows.find((row) => row.id === 'packaged_os_job_lifecycle');
  const operatorDashboard = matrix.rows.find((row) => row.id === 'operator_health_dashboard');
  const humanConsole = matrix.rows.find((row) => row.id === 'human_interrupt_review_and_approval_console');
  const docsTests = matrix.rows.find((row) => row.id === 'documentation_and_test_contracts');
  const improvement = matrix.rows.find((row) => row.id === 'bounded_self_improvement_loop');

  assert.equal(handoff.primitiveStatus, 'implemented');
  assert.equal(handoff.osProductStatus, 'implemented');
  assert.equal(productLifecycle.primitiveStatus, 'implemented');
  assert.equal(productLifecycle.osProductStatus, 'implemented');
  assert.equal(operatorDashboard.primitiveStatus, 'implemented');
  assert.equal(operatorDashboard.osProductStatus, 'implemented');
  assert.equal(humanConsole.primitiveStatus, 'implemented');
  assert.equal(humanConsole.osProductStatus, 'implemented');
  assert.equal(docsTests.primitiveStatus, 'implemented');
  assert.equal(docsTests.osProductStatus, 'implemented');
  assert.equal(improvement.primitiveStatus, 'implemented');
  assert.equal(improvement.osProductStatus, 'implemented');
});

test('Synthetic Labor OS summary is red when all rows are not product implemented', () => {
  const summary = summarizeSyntheticLaborOsCapabilityMatrix({
    generatedAt: '2026-06-29T00:00:00.000Z',
    rows: [
      { id: 'a', primitiveStatus: 'implemented', osProductStatus: 'implemented' },
      { id: 'b', primitiveStatus: 'implemented', osProductStatus: 'partial' }
    ]
  });

  assert.equal(summary.v0ProductReady, false);
  assert.equal(summary.byOsProductStatus.implemented, 1);
  assert.equal(summary.byOsProductStatus.partial, 1);
  assert.match(summary.truthBoundary, /not product-ready/);
});

test('Synthetic Labor OS markdown renders truth boundary and matrix', () => {
  const audit = buildSyntheticLaborOsAudit({ workspaceRoot: WORKSPACE_ROOT });
  const markdown = renderSyntheticLaborOsAuditMarkdown(audit);

  assert.match(markdown, /^# Synthetic Labor OS v0 Capability Matrix/);
  assert.match(markdown, /v0 product ready: (true|false)/);
  assert.match(markdown, /Human interrupt, review, and approval console/);
  assert.match(markdown, /Documentation and unit-test contracts/);
});

test('Synthetic Labor OS compile and queue stages attach operator-readable artifacts', () => {
  const job = createJob({ id: 'slos-contract-job', objective: 'Compile and queue demo job', requestedAgentCount: 2 });
  const intake = createJobIntakeContract({ job, why: 'prove chat intent is not enough by itself' });
  const compiled = compileJobContract(job, { surfaces: ['surface-a', 'surface-b'] });
  const queue = createWorkQueueArtifact({ job: compiled, workItems: [{ id: 'surface-a', title: 'Surface A', surfaceId: 'surface-a' }] });
  const queued = queueJob(compiled, { queue });

  assert.equal(intake.schemaVersion, 'claw.synthetic_labor_os.v0.intake_contract');
  assert.equal(compiled.state, 'compiled');
  assert.equal(compiled.artifacts.surfaceMatrix.rows.length, 2);
  assert.equal(queued.state, 'queued');
  assert.equal(queued.artifacts.workQueue.readyCount, 1);
  assert.match(queued.artifacts.workQueue.truthBoundary, /completion/);
});

test('Synthetic Labor OS job lifecycle blocks unverified completion claims', () => {
  const job = createJob({
    id: 'slos-test-job',
    objective: 'Prove OS lifecycle shell',
    repoPath: '/tmp/repo',
    requestedAgentCount: 3
  });
  const compiled = transitionJob(job, { to: 'compiled', reason: 'contract_compiled' });
  const queued = transitionJob(compiled, { to: 'queued', reason: 'operator_queued' });
  const running = transitionJob(queued, { to: 'running', reason: 'worker_pool_started' });

  assert.throws(
    () => transitionJob(running, { to: 'completed', reason: 'bad_completion_claim' }),
    /thresholdPass=true/
  );

  const reviewReady = transitionJob(running, {
    to: 'review_ready',
    reason: 'artifacts_ready_for_review',
    artifacts: { completionSummary: { thresholdPass: false } }
  });
  assert.equal(reviewReady.truth.status, 'awaiting_review');
  assert.equal(reviewReady.truth.completionClaimAllowed, false);
});

test('Synthetic Labor OS job lifecycle allows scoped completion only with green threshold and no blocker', () => {
  const job = createJob({ id: 'slos-green-job', objective: 'Scoped green job' });
  const compiled = transitionJob(job, { to: 'compiled' });
  const queued = transitionJob(compiled, { to: 'queued' });
  const running = transitionJob(queued, { to: 'running' });
  const completed = transitionJob(running, {
    to: 'completed',
    artifacts: { completionSummary: { thresholdPass: true } },
    reason: 'threshold_passed_for_contract'
  });

  assert.equal(completed.truth.status, 'green_for_job_contract');
  assert.equal(completed.truth.supervisorStatus, 'green');
  assert.equal(deriveJobTruth(completed).completionClaimAllowed, true);
});

test('Synthetic Labor OS operator dashboard is read-only and surfaces attention jobs', () => {
  const running = transitionJob(
    transitionJob(
      transitionJob(createJob({ id: 'slos-running-job', objective: 'Running job' }), { to: 'compiled' }),
      { to: 'queued' }
    ),
    { to: 'running' }
  );
  const blocked = transitionJob(createJob({ id: 'slos-blocked-job', objective: 'Blocked job' }), {
    to: 'blocked',
    blocker: { blockerKind: 'missing_review_console', blocker: 'Human approval console is not built yet.' }
  });
  const dashboard = buildOperatorDashboard({
    jobs: [running, blocked],
    capabilityAudit: buildSyntheticLaborOsAudit({ workspaceRoot: WORKSPACE_ROOT })
  });

  assert.equal(dashboard.readOnly, true);
  assert.equal(dashboard.behaviorChanging, false);
  assert.equal(dashboard.runningJobCount, 1);
  assert.equal(dashboard.attentionJobCount, 1);
  assert.deepEqual(dashboard.nextOperatorActions, [{ jobId: 'slos-blocked-job', action: 'inspect_blocker_or_replan' }]);

  const markdown = renderOperatorDashboardMarkdown(dashboard);
  assert.match(markdown, /Dashboard is read-only/);
  assert.match(markdown, /Blocked job/);
});

test('Synthetic Labor OS operator console pauses and resumes jobs without completing them', () => {
  const running = transitionJob(
    transitionJob(
      transitionJob(createJob({ id: 'slos-pause-job', objective: 'Pause/resume job' }), { to: 'compiled' }),
      { to: 'queued' }
    ),
    { to: 'running' }
  );
  const paused = pauseJob(running, { actor: 'jake', reason: 'inspect_artifacts_before_continue' });

  assert.equal(paused.state, 'paused');
  assert.equal(paused.truth.status, 'paused');
  assert.equal(paused.truth.completionClaimAllowed, false);

  const resumed = resumeJob(paused, { actor: 'jake', to: 'running' });
  assert.equal(resumed.state, 'running');
  assert.equal(resumed.truth.status, 'running');
});

test('Synthetic Labor OS operator console records review decisions without merge/publish/completion credit', () => {
  const running = transitionJob(
    transitionJob(
      transitionJob(createJob({ id: 'slos-review-job', objective: 'Review approval job' }), { to: 'compiled' }),
      { to: 'queued' }
    ),
    { to: 'running' }
  );
  const reviewReady = requestHumanReview(running, {
    actor: 'jake',
    patchId: 'patch-123',
    artifactRefs: ['artifacts/patch-123/summary.json'],
    reason: 'needs_human_patch_review'
  });

  assert.equal(reviewReady.state, 'review_ready');
  assert.equal(reviewReady.reviewSummary.pendingReviewCount, 1);
  assert.equal(reviewReady.truth.completionClaimAllowed, false);

  const approved = approvePatch(reviewReady, {
    actor: 'jake',
    patchId: 'patch-123',
    approvedScopes: ['local_merge_candidate'],
    rationale: 'looks safe for scoped candidate review'
  });

  assert.equal(summarizeJobReviews(approved.reviews).approvedReviewCount, 1);
  assert.equal(approved.operatorDecisions.at(-1).effect, 'approval_record_only_no_merge_no_publish_no_completion');
  assert.equal(approved.truth.completionClaimAllowed, false);

  const rejected = rejectPatch(approved, {
    actor: 'jake',
    patchId: 'patch-456',
    rejectedReasons: ['visual_gate_failed'],
    rationale: 'not good enough'
  });
  assert.equal(summarizeJobReviews(rejected.reviews).rejectedReviewCount, 1);
});

test('Synthetic Labor OS records test contracts and bounded improvement proposals', () => {
  const running = transitionJob(
    transitionJob(
      transitionJob(createJob({ id: 'slos-tests-job', objective: 'Tests are coordination contracts' }), { to: 'compiled' }),
      { to: 'queued' }
    ),
    { to: 'running' }
  );
  const testContract = createJobTestContract({ job: running, commands: ['node --test tests/synthetic-labor-os.test.mjs'] });
  const withEvidence = recordJobTestEvidence(running, { testContract, testRuns: [{ command: 'node --test tests/synthetic-labor-os.test.mjs', ok: true, exitCode: 0 }] });
  const proposal = createImprovementProposal({
    title: 'Make tests/docs first-class',
    sourceObservation: 'A review note said agents need tests and why-oriented docs.',
    proposedChange: 'Attach test contracts and documentation refs to each job.'
  });
  const evaluation = evaluateImprovementProposal(proposal, { testsPassed: true });

  assert.equal(withEvidence.artifacts.testEvidence.ok, true);
  assert.match(withEvidence.artifacts.testContract.why, /coordination contract/);
  assert.equal(evaluation.status, 'ready_for_review');
  assert.equal(evaluation.approvedToApply, false);
});

test('Synthetic Labor OS agent, patch, and execution-plane status stay visibility-only', () => {
  const agentStatus = buildAgentStatusRecords({ requestedAgentCount: 2, workerResults: [{ agentId: 'agent-1', state: 'running' }] });
  const patchStatus = buildPatchQueueStatus({ patches: [{ id: 'patch-1', status: 'conflicted', conflict: true }] });
  const registry = createExecutionPlaneRegistry({ planes: [{ id: 'hetzner', role: 'execution_plane', healthy: true, capacityAgentCount: 100 }] });
  const ready = evaluateExecutionPlaneReadiness(registry, { requestedAgentCount: 100 });
  const blocked = evaluateExecutionPlaneReadiness(createExecutionPlaneRegistry(), { requestedAgentCount: 100 });

  assert.equal(agentStatus.observedAgentCount, 2);
  assert.equal(patchStatus.conflictCount, 1);
  assert.equal(ready.ready, true);
  assert.equal(blocked.ready, false);
  assert.equal(blocked.blocker.blockerKind, 'missing_execution_plane_capacity');
});

test('Synthetic Labor OS clean demo proof writes scoped proof artifacts', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-demo-proof-'));
  const proof = buildCleanV0DemoProof({ workspaceRoot: WORKSPACE_ROOT, artifactRoot: temp, generatedAt: '2026-06-29T00:00:00.000Z' });
  const written = writeCleanV0DemoProof({ proof, artifactRoot: temp });

  assert.equal(proof.thresholdPass, true);
  assert.equal(proof.completionSummary.thresholdPass, true);
  assert.equal(proof.completedJob.truth.completionClaimAllowed, true);
  assert.ok(fs.existsSync(written.demoProofPath));
  assert.ok(fs.existsSync(written.completionSummaryPath));
  assert.ok(fs.existsSync(written.jobPath));
  assert.match(proof.truthBoundary, /not external publishing/);
});

test('Synthetic Labor OS admits a verified 100-agent scale proof without launching work', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-scale-proof-'));
  const waveRoot = path.join(temp, 'controller', 'waves', 'wave-001');
  fs.mkdirSync(waveRoot, { recursive: true });
  fs.writeFileSync(path.join(temp, 'local-verification-summary.json'), JSON.stringify({
    thresholdPass: true,
    mechanicalGreen: true,
    scaleProofReady: true,
    blocker: null,
    uniqueAgentCount: 100,
    peakConcurrency: 100,
    shardCount: 100,
    mergedShardCount: 100,
    durationMinutes: 31,
    codexCallsStarted: 100,
    codexCallsCompleted: 100,
    productiveSurfaceCount: 100,
    creativeProductDeltaIntegrity: 1,
    activeWorkerMinutes: 3000
  }, null, 2));
  fs.mkdirSync(path.join(temp, 'controller'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'controller', 'completion_summary.json'), JSON.stringify({
    benchmarkId: 'agent_work_default_path_model_100agent_30m',
    runId: 'fixture',
    thresholdPass: true,
    mechanicalGreen: true,
    scaleProofReady: true,
    blocker: null,
    waveCount: 1
  }, null, 2));
  fs.writeFileSync(path.join(waveRoot, 'completion_summary.json'), JSON.stringify({
    benchmarkId: 'agent_work_default_path_model_100agent_30m',
    runId: 'fixture-wave',
    thresholdPass: true,
    mechanicalGreen: true,
    scaleProofReady: true,
    requestedAgentCount: 100,
    peakConcurrency: 100,
    shardCount: 100,
    mergedShardCount: 100,
    durationMinutes: 31,
    blocker: null
  }, null, 2));
  fs.writeFileSync(path.join(waveRoot, 'creative_worker_evidence.json'), JSON.stringify({
    okSurfaceCount: 100,
    creativeProductDeltaIntegrity: 1
  }, null, 2));

  const proof = admitHundredAgentScaleProof({ sourceRoot: temp });
  const written = writeHundredAgentScaleProof({ proof, artifactRoot: temp });

  assert.equal(proof.admitted, true);
  assert.equal(proof.thresholdPass, true);
  assert.equal(proof.metrics.uniqueAgentCount, 100);
  assert.match(proof.truthBoundary, /No new 100-agent run was launched/);
  assert.ok(fs.existsSync(written.scaleProofPath));
});

test('Synthetic Labor OS v1 local execution plan records worker evidence and gates claims', () => {
  const job = createJob({ id: 'slos-v1-local-plan', objective: 'Run a local deterministic queue item', requestedAgentCount: 1 });
  const testContract = createJobTestContract({ job, commands: ['node --version'] });
  const compiled = compileJobContract(job, { surfaces: ['local_runner_surface'] });
  const queue = createWorkQueueArtifact({ job: compiled, workItems: [{ id: 'local-runner-surface', surfaceId: 'local_runner_surface', title: 'Local runner surface' }] });
  const queued = queueJob({ ...compiled, artifacts: { ...compiled.artifacts, testContract } }, { queue });
  const executionPlan = createLocalExecutionPlan({ job: queued, testContract });
  const commandResult = createCommandExecutionResult({ command: 'node --version', exitCode: 0, stdout: 'v22.0.0\n', logPath: '/tmp/command.log' });
  const workerRun = buildLocalWorkerRun({ job: queued, executionPlan, commandResults: [commandResult] });
  const withTests = recordJobTestEvidence(transitionJob(queued, { to: 'running' }), {
    testContract,
    testRuns: [{ command: commandResult.command, ok: commandResult.ok, exitCode: commandResult.exitCode, artifactRef: commandResult.logPath }]
  });
  const claimGate = buildJobClaimGate({ job: withTests, workerRun, testEvidence: withTests.artifacts.testEvidence });
  const blockedPlan = createLocalExecutionPlan({ job: { ...queued, requestedAgentCount: 50 }, requestedAgentCount: 50, testContract });

  assert.equal(executionPlan.ok, true);
  assert.equal(workerRun.ok, true);
  assert.equal(workerRun.completedItemCount, 1);
  assert.equal(claimGate.completionClaimAllowed, true);
  assert.equal(claimGate.completionSummary.thresholdPass, true);
  assert.equal(blockedPlan.ok, false);
  assert.ok(blockedPlan.failures.includes('requested_agent_count_exceeds_local_runner_limit'));
});

test('Synthetic Labor OS local runner CLI executes a queued job and writes scoped artifacts', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-local-runner-cli-'));
  const jobsDir = path.join(temp, 'jobs');
  const job = createJob({ id: 'slos-v1-cli-job', objective: 'CLI local runner job', repoPath: WORKSPACE_ROOT, requestedAgentCount: 1, artifactRoot: temp });
  const testContract = createJobTestContract({ job, commands: ['node --version'] });
  const compiled = compileJobContract(job, { artifactRoot: temp, surfaces: ['cli_local_runner_surface'] });
  const queue = createWorkQueueArtifact({ job: compiled, workItems: [{ id: 'cli-local-runner-surface', surfaceId: 'cli_local_runner_surface', title: 'CLI local runner surface' }] });
  const queued = queueJob({ ...compiled, artifacts: { ...compiled.artifacts, testContract } }, { queue });
  const { jobPath } = writeSyntheticLaborOsJob({ job: queued, jobsDir });
  const cli = path.join(WORKSPACE_ROOT, 'large-project-capability-stack/apps/synthetic-labor-os/local-runner.mjs');

  const run = spawnSync(process.execPath, [cli, '--job', jobPath, '--artifact-root', temp, '--cwd', WORKSPACE_ROOT], { cwd: WORKSPACE_ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  const finalJob = JSON.parse(fs.readFileSync(jobPath, 'utf8'));

  assert.equal(payload.ok, true);
  assert.equal(payload.state, 'completed');
  assert.equal(finalJob.state, 'completed');
  assert.equal(finalJob.truth.completionClaimAllowed, true);
  assert.ok(fs.existsSync(payload.written.workerRunPath));
  assert.ok(fs.existsSync(payload.written.claimGatePath));
  assert.ok(fs.existsSync(payload.written.artifactBundleManifestPath));
  assert.equal(payload.artifactBundle.summary.ok, true);
  assert.ok(payload.artifactBundle.files.some((file) => file.path.endsWith('worker_run.json')));
  const writtenManifest = JSON.parse(fs.readFileSync(payload.written.artifactBundleManifestPath, 'utf8'));
  const verifiedManifest = verifyArtifactBundleManifest({ artifactRoot: temp, manifest: writtenManifest });
  assert.equal(verifiedManifest.ok, true);
  assert.equal(verifiedManifest.summary.verifiedFileCount, writtenManifest.files.length);
  assert.match(payload.truthBoundary, /does not merge, publish/);
});

test('Synthetic Labor OS artifact bundle manifests detect missing and tampered proof files', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-artifact-bundle-'));
  const proofDir = path.join(temp, 'proof');
  fs.mkdirSync(proofDir, { recursive: true });
  fs.writeFileSync(path.join(proofDir, 'worker_run.json'), '{"ok":true}\n');
  fs.writeFileSync(path.join(proofDir, 'claim_gate.json'), '{"thresholdPass":true}\n');

  const invalidManifest = createArtifactBundleManifest({
    artifactRoot: temp,
    includePaths: ['proof/worker_run.json', 'proof/claim_gate.json', '../escape.json', 'proof/missing.json'],
    label: 'unit-test-bundle',
    createdBy: 'unit-test'
  });
  const manifest = createArtifactBundleManifest({
    artifactRoot: temp,
    includePaths: ['proof/worker_run.json', 'proof/claim_gate.json'],
    label: 'unit-test-bundle',
    createdBy: 'unit-test'
  });
  const green = verifyArtifactBundleManifest({ artifactRoot: temp, manifest });
  fs.writeFileSync(path.join(proofDir, 'worker_run.json'), '{"ok":false}\n');
  fs.unlinkSync(path.join(proofDir, 'claim_gate.json'));
  const red = verifyArtifactBundleManifest({ artifactRoot: temp, manifest });

  assert.equal(invalidManifest.summary.ok, false);
  assert.equal(invalidManifest.summary.fileCount, 2);
  assert.equal(invalidManifest.summary.missingCount, 1);
  assert.equal(invalidManifest.summary.invalidPathCount, 1);
  assert.equal(manifest.summary.ok, true);
  assert.equal(green.ok, true);
  assert.equal(red.ok, false);
  assert.deepEqual(red.missingFiles, ['proof/claim_gate.json']);
  assert.equal(red.mismatchedFiles[0].path, 'proof/worker_run.json');
  assert.match(red.truthBoundary, /does not prove tests were sufficient/);
});

test('Synthetic Labor OS v2 remote dispatch manifest requires sync/provenance boundaries', () => {
  const job = createJob({ id: 'slos-v2-remote-manifest', objective: 'Remote dispatch manifest', requestedAgentCount: 1 });
  const missing = createRemoteDispatchManifest({ job, command: 'node --version' });
  const ready = createRemoteDispatchManifest({
    job,
    localRepoPath: '/local/repo',
    localArtifactRoot: '/local/artifacts',
    remoteHost: 'jake@example.test',
    remoteRepoPath: '/remote/repo',
    remoteArtifactRoot: '/remote/artifacts',
    command: 'node --version',
    codeSyncPaths: ['package.json']
  });

  assert.equal(missing.okToLaunch, false);
  assert.ok(missing.failures.includes('missing_remote_host'));
  assert.equal(ready.okToLaunch, true);
  assert.equal(ready.remoteJobPath, '/remote/artifacts/jobs/slos-v2-remote-manifest.json');
  assert.equal(ready.safety.remoteExecutionPlaneRequired, true);
  assert.match(ready.truthBoundary, /Remote dispatch/);
});

test('Synthetic Labor OS v2 remote dispatch result only goes green with sync, runner, claim gate, and returned artifacts', () => {
  const job = createJob({ id: 'slos-v2-remote-result', objective: 'Remote result' });
  const manifest = createRemoteDispatchManifest({
    job,
    localRepoPath: '/local/repo',
    localArtifactRoot: '/local/artifacts',
    remoteHost: 'jake@example.test',
    remoteRepoPath: '/remote/repo',
    remoteArtifactRoot: '/remote/artifacts',
    command: 'node --version',
    codeSyncPaths: ['package.json']
  });
  const green = evaluateRemoteDispatchResult({
    manifest,
    syncProof: { matched: true },
    remoteRun: { exitCode: 0, runnerPayload: { ok: true, jobId: job.id, claimGate: { thresholdPass: true } } },
    runnerPayload: { ok: true, jobId: job.id, claimGate: { thresholdPass: true } },
    artifactReturn: { returned: true },
    artifactIntegrity: { ok: true }
  });
  const red = evaluateRemoteDispatchResult({
    manifest,
    syncProof: { matched: false },
    remoteRun: { exitCode: 0, runnerPayload: { ok: true, jobId: job.id, claimGate: { thresholdPass: true } } },
    runnerPayload: { ok: true, jobId: job.id, claimGate: { thresholdPass: true } },
    artifactReturn: { returned: true },
    artifactIntegrity: { ok: true }
  });
  const tampered = evaluateRemoteDispatchResult({
    manifest,
    syncProof: { matched: true },
    remoteRun: { exitCode: 0, runnerPayload: { ok: true, jobId: job.id, claimGate: { thresholdPass: true } } },
    runnerPayload: { ok: true, jobId: job.id, claimGate: { thresholdPass: true } },
    artifactReturn: { returned: true },
    artifactIntegrity: { ok: false, summary: { mismatchCount: 1 } }
  });

  assert.equal(green.ok, true);
  assert.equal(green.completionSummary.thresholdPass, true);
  assert.equal(green.completionSummary.artifactBundleVerified, true);
  assert.equal(red.ok, false);
  assert.ok(red.failures.includes('code_sync_hash_mismatch'));
  assert.equal(tampered.ok, false);
  assert.ok(tampered.failures.includes('artifact_bundle_integrity_failed'));
  assert.match(red.truthBoundary, /blocked/);
});

test('Synthetic Labor OS v19 run ledger and release packet link winner evidence into a claim packet', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-v19-ledger-'));
  const { runSummaryPath, patchSha256, priorArtGatePath } = createV18LedgerFixture(temp);
  const ledger = buildRunLedger({ runSummaryPath, priorArtGatePath, repoRoot: WORKSPACE_ROOT, generatedAt: '2026-06-30T00:00:00.000Z' });
  const manifest = createArtifactBundleManifest({
    artifactRoot: temp,
    includePaths: ['v18_whole_os_tournament_summary.json', 'v18_whole_os_tournament_remote_summary.json', 'v18_winner_apply_summary.json'],
    label: 'v19-unit-fixture',
    createdBy: 'unit-test'
  });
  const verification = verifyArtifactBundleManifest({ artifactRoot: temp, manifest });
  const packet = buildReleasePacket({ ledger, artifactBundleManifest: manifest, artifactBundleVerification: verification, ledgerPath: runSummaryPath, packetRoot: temp });
  const markdown = renderReleasePacketMarkdown(packet);

  assert.equal(ledger.ok, true);
  assert.equal(ledger.status, 'green_run_ledger');
  assert.equal(ledger.execution.observedAgentCount, 100);
  assert.equal(ledger.selectedCandidate.id, 'candidate_08');
  assert.equal(ledger.selectedCandidate.patchSha256, patchSha256);
  assert.equal(ledger.selectedCandidate.patchShaMatches, true);
  assert.equal(ledger.evidenceSummary.missingRequiredLabels.length, 0);
  assert.equal(ledger.gates.every((entry) => entry.ok), true);
  assert.equal(ledger.priorArtGate.decision, 'adapter_wrapper_only');
  assert.equal(ledger.proofCarryingClaimLedger.summary.status, 'green');
  assert.equal(ledger.mergeEligibility.eligible, true);
  assert.equal(packet.ok, true);
  assert.equal(packet.status, 'green_release_packet');
  assert.match(markdown, /Synthetic Labor OS v19 Release Packet/);
  assert.match(markdown, /Prior-art \/ reuse gate/);
  assert.match(packet.truthBoundary, /does not merge, publish/);

  const blockedLedger = buildRunLedger({ runSummaryPath, priorArtGatePath, approval: { approved: false }, generatedAt: '2026-06-30T00:00:00.000Z' });
  assert.equal(blockedLedger.ok, false);
  assert.ok(blockedLedger.failures.includes('gate_failed:operator_approval_green'));
});

test('Synthetic Labor OS v19 release packet CLI writes a portable evidence bundle', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-v19-cli-fixture-'));
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-v19-cli-artifacts-'));
  const { runSummaryPath } = createV18LedgerFixture(fixtureRoot);
  const cli = path.join(WORKSPACE_ROOT, 'large-project-capability-stack/apps/synthetic-labor-os/v19-release-packet.mjs');
  const stackRoot = path.join(WORKSPACE_ROOT, 'large-project-capability-stack');
  const run = spawnSync(process.execPath, [cli, '--artifact-root', artifactRoot, '--v18-summary', runSummaryPath, '--repo-root', stackRoot], { cwd: WORKSPACE_ROOT, encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  const ledger = JSON.parse(fs.readFileSync(payload.ledgerPath, 'utf8'));
  const packet = JSON.parse(fs.readFileSync(payload.packetPath, 'utf8'));
  const bundleVerification = JSON.parse(fs.readFileSync(payload.artifactBundleVerificationPath, 'utf8'));

  assert.equal(payload.ok, true);
  assert.equal(ledger.ok, true);
  assert.equal(packet.ok, true);
  assert.equal(ledger.priorArtGate.decision, 'adapter_wrapper_only');
  assert.equal(ledger.proofCarryingClaimLedger.summary.status, 'green');
  assert.equal(bundleVerification.ok, true);
  assert.equal(payload.copiedEvidenceCount, payload.evidenceCount);
  assert.ok(fs.existsSync(payload.markdownPath));
  assert.ok(fs.existsSync(payload.checksumsPath));
  assert.match(packet.truthBoundary, /release packet packages one bounded SLOS run/);
});

test('Synthetic Labor OS v20 hard dogfood dependency manifest makes remote inputs explicit', () => {
  const manifest = buildV20HardDogfoodDependencyManifest({
    generatedAt: '2026-06-30T00:00:00.000Z',
    workspaceRoot: '/workspace',
    stackRoot: '/workspace/large-project-capability-stack',
    remoteRoot: '/remote/clawd',
    remoteHost: 'jake@example.invalid'
  });
  const stackGroup = manifest.groups.find((group) => group.id === 'stack_code_sync');
  const cortexGroup = manifest.groups.find((group) => group.id === 'public_cortex_prior_art');
  const mailchimpGroup = manifest.groups.find((group) => group.id === 'mailchimp_product_smoke');

  assert.equal(manifest.schemaVersion, 'claw.synthetic_labor_os.v20.dependency_sync_manifest.v1');
  assert.equal(manifest.groupCount, 3);
  assert.equal(stackGroup.transport, 'remote_dispatcher_code_sync');
  assert.ok(stackGroup.paths.includes('apps/synthetic-labor-os/v20-hard-dogfood-rc.mjs'));
  assert.ok(stackGroup.paths.includes('apps/system-benchmark/evaluate-production-quality-gate.mjs'));
  assert.ok(stackGroup.paths.includes('packages/orchestration-learning-ledger/index.mjs'));
  assert.equal(cortexGroup.transport, 'pre_sync_tar_ssh');
  assert.ok(cortexGroup.paths.includes('public/cortex_server/scripts/prior_art_gate.py'));
  assert.ok(cortexGroup.paths.includes('public/cortex_server/cortex_server/runtime/agent_work_dsl.py'));
  assert.equal(mailchimpGroup.transport, 'pre_sync_tar_ssh');
  assert.ok(mailchimpGroup.paths.includes('mailchimp-clone/tests/platform-spine.test.mjs'));
  assert.equal(manifest.safety.mergePublishDeployAllowed, false);
});

test('Synthetic Labor OS v20 release-candidate packet gates hard dogfood evidence', () => {
  const logSummary = summarizeHardEvidenceLog([
    '::public_cortex_prior_art_gate',
    'prior_art_gate_ok reuse_existing 27',
    '::shared_stack_orchestration_suite',
    '# tests 234',
    '# pass 234',
    '# fail 0',
    '::cortex_structural_memory_mirror',
    'cortex_structural_health_ok 13883 51153',
    '::mailchimp_product_smoke',
    '# tests 4',
    '# pass 4',
    '# fail 0'
  ].join('\n'));
  const dependencyManifest = buildV20HardDogfoodDependencyManifest({ generatedAt: '2026-06-30T00:00:00.000Z' });
  const summary = {
    runId: 'v20-hard-fixture',
    jobId: 'slos-v20-hard-fixture',
    artifactRoot: '/tmp/v20-hard-fixture',
    remoteHost: 'jake@example.invalid',
    preSync: { ok: true },
    priorArtGate: { ok: true, decision: 'reuse_existing', highConfidence: 27 },
    remoteDispatch: { ok: true, thresholdPass: true, completionClaimAllowed: true, failures: [] },
    hardEvidence: { summaryOk: true, combinedLogPath: '/tmp/v20-hard-fixture/hard_multirepo_combined.log' },
    artifactIntegrityOk: true,
    syncPathCount: 93
  };

  const packet = buildV20ReleaseCandidatePacket({
    generatedAt: '2026-06-30T00:00:00.000Z',
    summary,
    remoteDispatch: summary.remoteDispatch,
    artifactIntegrity: { ok: true },
    dependencyManifest,
    logSummary,
    dependencyManifestPath: '/tmp/v20-hard-fixture/dependency_sync_manifest.json',
    artifactIntegrityPath: '/tmp/v20-hard-fixture/artifact_integrity.json'
  });
  const markdown = renderV20ReleaseCandidateMarkdown(packet);

  assert.equal(packet.ok, true);
  assert.equal(packet.status, 'green_v0_1_release_candidate_packet');
  assert.equal(packet.observed.sharedStack.tests, 234);
  assert.equal(packet.observed.mailchimpSmoke.pass, 4);
  assert.equal(packet.observed.cortexStructuralHealth.nodeCount, 13883);
  assert.match(markdown, /Synthetic Labor OS v20 \/ v0\.1 Release Candidate Packet/);

  const blocked = buildV20ReleaseCandidatePacket({ summary: { ...summary, preSync: { ok: false } }, dependencyManifest, artifactIntegrity: { ok: true }, logSummary });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.failures.includes('gate_failed:pre_sync_green'));
});

test('Synthetic Labor OS v3 Codex work item wrapper verifies structured agent evidence without real provider calls in tests', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-v3-fake-codex-'));
  const fakeCodex = path.join(temp, 'fake-codex.mjs');
  fs.writeFileSync(fakeCodex, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli fake-test'); process.exit(0); }
const outputIndex = args.indexOf('--output-last-message');
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
if (!outputPath) process.exit(2);
fs.writeFileSync(outputPath, JSON.stringify({
  marker: 'SLOS_CODEX_AGENT_WORK_ITEM_DONE',
  jobId: 'slos-v3-wrapper-test',
  workItem: 'remote-codex-bounded-audit',
  observedFiles: ['packages/synthetic-labor-os/index.mjs'],
  recommendation: 'Keep the remote Codex work item bounded and require returned provenance before any completion claim.',
  nextActions: ['Run the real v3 pilot on the execution plane'],
  truthBoundary: 'Remote Codex agent work item only; no merge/publish/broad-scale proof.'
}));
console.log(JSON.stringify({ type: 'agent_message', model: 'fake-codex', usage: { input_tokens: 10, output_tokens: 5 } }));
process.exit(0);
`);
  fs.chmodSync(fakeCodex, 0o755);
  const cli = path.join(WORKSPACE_ROOT, 'large-project-capability-stack/apps/synthetic-labor-os/codex-agent-work-item.mjs');
  const run = spawnSync(process.execPath, [
    cli,
    '--job-id', 'slos-v3-wrapper-test',
    '--artifact-root', temp,
    '--repo-root', WORKSPACE_ROOT,
    '--codex-bin', fakeCodex,
    '--max-runtime-ms', '30000'
  ], { cwd: WORKSPACE_ROOT, encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  const proof = JSON.parse(fs.readFileSync(payload.proofPath, 'utf8'));

  assert.equal(payload.ok, true);
  assert.equal(proof.ok, true);
  assert.equal(proof.codex.exitCode, 0);
  assert.equal(proof.verification.ok, true);
  assert.equal(proof.agentOutput.marker, 'SLOS_CODEX_AGENT_WORK_ITEM_DONE');
  assert.equal(proof.eventSummary.observedPositiveTokenValueCount >= 1, true);
  assert.match(proof.truthBoundary, /bounded read-only remote Codex CLI work item/);
});

test('Synthetic Labor OS v4 Codex patch proposal wrapper verifies review-ready diff without applying it', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-v4-fake-codex-'));
  const repo = path.join(temp, 'repo');
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'existing.md'), '# Existing docs\n');
  const fakeCodex = path.join(temp, 'fake-codex.mjs');
  fs.writeFileSync(fakeCodex, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli fake-patch-test'); process.exit(0); }
const outputIndex = args.indexOf('--output-last-message');
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
if (!outputPath) process.exit(2);
const diff = [
  'diff --git a/docs/SYNTHETIC_LABOR_OS_V4_PATCH_PROPOSAL.md b/docs/SYNTHETIC_LABOR_OS_V4_PATCH_PROPOSAL.md',
  'new file mode 100644',
  'index 0000000..1111111',
  '--- /dev/null',
  '+++ b/docs/SYNTHETIC_LABOR_OS_V4_PATCH_PROPOSAL.md',
  '@@ -0,0 +1,5 @@',
  '+# Synthetic Labor OS v4 Patch Proposal',
  '+',
  '+This patch remains review-only.',
  '+',
  '+It is not applied.'
].join('\\n') + '\\n';
fs.writeFileSync(outputPath, JSON.stringify({
  marker: 'SLOS_CODEX_PATCH_PROPOSAL_DONE',
  jobId: 'slos-v4-wrapper-test',
  workItem: 'remote-codex-reviewable-patch-proposal',
  targetFiles: ['docs/SYNTHETIC_LABOR_OS_V4_PATCH_PROPOSAL.md'],
  rationale: 'Create a small review-only documentation proposal that proves patch artifacts can be returned without applying them.',
  unifiedDiff: diff,
  tests: ['git apply --check --whitespace=nowarn patch_proposal.diff'],
  truthBoundary: 'Remote Codex patch proposal only; patch not applied/merged/published.'
}));
console.log(JSON.stringify({ type: 'agent_message', model: 'fake-codex', usage: { input_tokens: 12, output_tokens: 7 } }));
process.exit(0);
`);
  fs.chmodSync(fakeCodex, 0o755);
  const cli = path.join(WORKSPACE_ROOT, 'large-project-capability-stack/apps/synthetic-labor-os/codex-patch-proposal-work-item.mjs');
  const run = spawnSync(process.execPath, [
    cli,
    '--job-id', 'slos-v4-wrapper-test',
    '--artifact-root', temp,
    '--repo-root', repo,
    '--codex-bin', fakeCodex,
    '--max-runtime-ms', '30000',
    '--context-file', 'docs/existing.md',
    '--allowed-target', 'docs/SYNTHETIC_LABOR_OS_V4_PATCH_PROPOSAL.md'
  ], { cwd: WORKSPACE_ROOT, encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  const proof = JSON.parse(fs.readFileSync(payload.proofPath, 'utf8'));

  assert.equal(payload.ok, true);
  assert.equal(payload.reviewReady, true);
  assert.equal(proof.ok, true);
  assert.equal(proof.reviewReady, true);
  assert.equal(proof.patchApplied, false);
  assert.equal(proof.patchVerification.gitApplyCheck.ok, true);
  assert.deepEqual(proof.patchVerification.diffPaths, ['docs/SYNTHETIC_LABOR_OS_V4_PATCH_PROPOSAL.md']);
  assert.equal(fs.existsSync(path.join(repo, 'docs', 'SYNTHETIC_LABOR_OS_V4_PATCH_PROPOSAL.md')), false);
  assert.match(proof.truthBoundary, /patch proposal is review-ready/);
});

test('Synthetic Labor OS v5 apply gate requires approval, applies patch, and validates without merge or publish', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-v5-apply-gate-'));
  const repo = path.join(temp, 'repo');
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' });
  const patchPath = path.join(temp, 'approved.patch');
  const patch = [
    'diff --git a/docs/v5-approved.md b/docs/v5-approved.md',
    'new file mode 100644',
    'index 0000000..1111111',
    '--- /dev/null',
    '+++ b/docs/v5-approved.md',
    '@@ -0,0 +1,3 @@',
    '+# v5 approved patch',
    '+',
    '+Applied by a gated test.'
  ].join('\n') + '\n';
  fs.writeFileSync(patchPath, patch);
  const patchSha = fs.readFileSync(patchPath).toString('utf8');
  const approvalPath = path.join(temp, 'approval.json');
  fs.writeFileSync(approvalPath, JSON.stringify({
    schemaVersion: 'claw.synthetic_labor_os.v5.patch_apply_approval',
    approvalId: 'approval-test-v5',
    approvedAt: '2026-06-29T00:00:00.000Z',
    approved: true,
    actor: 'test-operator',
    patchPath,
    patchSha256: crypto.createHash('sha256').update(patchSha).digest('hex'),
    approvedTargets: ['docs/v5-approved.md']
  }, null, 2));
  const cli = path.join(WORKSPACE_ROOT, 'large-project-capability-stack/apps/synthetic-labor-os/apply-patch-gate.mjs');
  const run = spawnSync(process.execPath, [
    cli,
    '--patch', patchPath,
    '--approval', approvalPath,
    '--artifact-root', path.join(temp, 'artifacts'),
    '--repo-root', repo,
    '--allowed-target', 'docs/v5-approved.md',
    '--validation-command', 'test -f docs/v5-approved.md'
  ], { cwd: WORKSPACE_ROOT, encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  const proof = JSON.parse(fs.readFileSync(payload.proofPath, 'utf8'));

  assert.equal(payload.ok, true);
  assert.equal(payload.patchApplied, true);
  assert.equal(proof.implementationClaimAllowedForApprovedPatch, true);
  assert.deepEqual(proof.targetSnapshots.changedTargets, ['docs/v5-approved.md']);
  assert.equal(fs.existsSync(path.join(repo, 'docs', 'v5-approved.md')), true);
  assert.match(proof.truthBoundary, /not a merge, publish/);
});

test('Synthetic Labor OS v6 provenance chain links proposal, approval, apply, and validation artifacts', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-v6-provenance-'));
  const repo = path.join(temp, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const patchPath = path.join(temp, 'patch.diff');
  fs.writeFileSync(patchPath, 'diff --git a/docs/v6.md b/docs/v6.md\nnew file mode 100644\n--- /dev/null\n+++ b/docs/v6.md\n@@ -0,0 +1 @@\n+# v6\n');
  const patchSha = crypto.createHash('sha256').update(fs.readFileSync(patchPath)).digest('hex');
  const v4ProofPath = path.join(temp, 'v4-proof.json');
  fs.writeFileSync(v4ProofPath, JSON.stringify({
    ok: true,
    reviewReady: true,
    patchApplied: false,
    codex: { version: 'codex-cli fake' },
    patchProposal: { path: patchPath, sha256: patchSha, targetFiles: ['docs/v6.md'] },
    patchVerification: { gitApplyCheck: { ok: true } }
  }, null, 2));
  const v4SummaryPath = path.join(temp, 'v4-summary.json');
  fs.writeFileSync(v4SummaryPath, JSON.stringify({
    ok: true,
    reviewReady: true,
    patchApplied: false,
    targetFiles: ['docs/v6.md'],
    returnedPatchProofPath: v4ProofPath,
    codexVersion: 'codex-cli fake',
    remoteHost: 'remote.example'
  }, null, 2));
  const approvalPath = path.join(temp, 'approval.json');
  fs.writeFileSync(approvalPath, JSON.stringify({
    schemaVersion: 'claw.synthetic_labor_os.v5.patch_apply_approval',
    approvalId: 'approval-v6-test',
    approved: true,
    actor: 'test-operator',
    approvedAt: '2026-06-29T00:00:00.000Z',
    patchSha256: patchSha,
    approvedTargets: ['docs/v6.md'],
    prohibitedActions: ['merge', 'publish', 'deploy', 'external_send', 'broad_scale_claim']
  }, null, 2));
  const v5ProofPath = path.join(temp, 'v5-proof.json');
  fs.writeFileSync(v5ProofPath, JSON.stringify({
    ok: true,
    patchApplied: true,
    implementationClaimAllowedForApprovedPatch: true,
    patch: { sha256: patchSha, diffPaths: ['docs/v6.md'] },
    approval: { verification: { ok: true } },
    gates: {
      gitApplyCheck: { ok: true },
      gitApply: { ok: true },
      validationRuns: [{ command: 'test', ok: true, exitCode: 0, durationMs: 1 }]
    },
    targetSnapshots: { changedTargets: ['docs/v6.md'] }
  }, null, 2));
  const v5SummaryPath = path.join(temp, 'v5-summary.json');
  fs.writeFileSync(v5SummaryPath, JSON.stringify({
    ok: true,
    patchApplied: true,
    implementationClaimAllowedForApprovedPatch: true,
    patchPath,
    patchSha256: patchSha,
    approvalPath,
    proofPath: v5ProofPath
  }, null, 2));

  const cli = path.join(WORKSPACE_ROOT, 'large-project-capability-stack/apps/synthetic-labor-os/v6-provenance-chain.mjs');
  const run = spawnSync(process.execPath, [
    cli,
    '--artifact-root', path.join(temp, 'artifacts'),
    '--repo-root', repo,
    '--v4-summary', v4SummaryPath,
    '--v5-summary', v5SummaryPath
  ], { cwd: WORKSPACE_ROOT, encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  const chain = JSON.parse(fs.readFileSync(payload.chainPath, 'utf8'));

  assert.equal(payload.ok, true);
  assert.equal(chain.links.proposal.ok, true);
  assert.equal(chain.links.approval.ok, true);
  assert.equal(chain.links.apply.ok, true);
  assert.equal(chain.links.validation.ok, true);
  assert.deepEqual(chain.patch.changedTargets, ['docs/v6.md']);
  assert.match(chain.truthBoundary, /not a merge, publish/);
});

test('Synthetic Labor OS v7 through v11 finish and release pipeline passes over fixture artifacts without external writes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-v10-finish-'));
  const repo = path.join(temp, 'repo');
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' });
  const patchPath = path.join(temp, 'patch.diff');
  fs.writeFileSync(patchPath, [
    'diff --git a/docs/v10.md b/docs/v10.md',
    'new file mode 100644',
    'index 0000000..1111111',
    '--- /dev/null',
    '+++ b/docs/v10.md',
    '@@ -0,0 +1,3 @@',
    '+# v10',
    '+',
    '+Fixture patch.'
  ].join('\n') + '\n');
  assert.equal(spawnSync('git', ['apply', patchPath], { cwd: repo, encoding: 'utf8' }).status, 0);
  const patchSha = crypto.createHash('sha256').update(fs.readFileSync(patchPath)).digest('hex');
  const v4ProofPath = path.join(temp, 'v4-proof.json');
  fs.writeFileSync(v4ProofPath, JSON.stringify({
    ok: true,
    reviewReady: true,
    patchApplied: false,
    codex: { version: 'codex-cli fake', exitCode: 0 },
    patchProposal: { path: patchPath, sha256: patchSha, targetFiles: ['docs/v10.md'] },
    patchVerification: { gitApplyCheck: { ok: true } }
  }, null, 2));
  const v4SummaryPath = path.join(temp, 'v4-summary.json');
  fs.writeFileSync(v4SummaryPath, JSON.stringify({
    ok: true,
    reviewReady: true,
    patchApplied: false,
    targetFiles: ['docs/v10.md'],
    returnedPatchProofPath: v4ProofPath,
    codexVersion: 'codex-cli fake',
    remoteHost: 'remote.example'
  }, null, 2));
  const approvalPath = path.join(temp, 'approval.json');
  fs.writeFileSync(approvalPath, JSON.stringify({
    schemaVersion: 'claw.synthetic_labor_os.v5.patch_apply_approval',
    approvalId: 'approval-v10-test',
    approved: true,
    actor: 'test-operator',
    approvedAt: '2026-06-29T00:00:00.000Z',
    patchSha256: patchSha,
    approvedTargets: ['docs/v10.md'],
    prohibitedActions: ['merge', 'publish', 'deploy', 'external_send', 'broad_scale_claim']
  }, null, 2));
  const v5ProofPath = path.join(temp, 'v5-proof.json');
  fs.writeFileSync(v5ProofPath, JSON.stringify({
    ok: true,
    patchApplied: true,
    implementationClaimAllowedForApprovedPatch: true,
    gitApplyContext: { cwd: repo, directoryArg: '', gitTopLevel: repo, relativeRepoPath: '' },
    patch: { sha256: patchSha, diffPaths: ['docs/v10.md'] },
    approval: { verification: { ok: true } },
    gates: {
      gitApplyCheck: { ok: true },
      gitApply: { ok: true },
      validationRuns: [{ command: 'test', ok: true, exitCode: 0, durationMs: 1 }]
    },
    targetSnapshots: { changedTargets: ['docs/v10.md'] }
  }, null, 2));
  const v5SummaryPath = path.join(temp, 'v5-summary.json');
  fs.writeFileSync(v5SummaryPath, JSON.stringify({
    ok: true,
    patchApplied: true,
    implementationClaimAllowedForApprovedPatch: true,
    patchPath,
    patchSha256: patchSha,
    approvalPath,
    proofPath: v5ProofPath
  }, null, 2));
  const v0MatrixPath = path.join(temp, 'v0-matrix.json');
  fs.writeFileSync(v0MatrixPath, JSON.stringify({
    summary: {
      v0ProductReady: true,
      byPrimitiveStatus: { implemented: 14, partial: 0, missing: 0 },
      byOsProductStatus: { implemented: 14, partial: 0, missing: 0 },
      honestClaim: 'fixture green'
    }
  }, null, 2));
  const stackRoot = path.join(WORKSPACE_ROOT, 'large-project-capability-stack');
  const run = (script, args = []) => spawnSync(process.execPath, [path.join(stackRoot, script), ...args], { cwd: stackRoot, encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });

  const v6 = run('apps/synthetic-labor-os/v6-provenance-chain.mjs', ['--artifact-root', path.join(temp, 'v6'), '--repo-root', repo, '--v4-summary', v4SummaryPath, '--v5-summary', v5SummaryPath]);
  assert.equal(v6.status, 0, v6.stderr || v6.stdout);
  const v7 = run('apps/synthetic-labor-os/v7-replay-rollback-audit.mjs', ['--artifact-root', path.join(temp, 'v7'), '--repo-root', repo, '--chain', path.join(temp, 'v6/v6_provenance_chain.json')]);
  assert.equal(v7.status, 0, v7.stderr || v7.stdout);
  const v8 = run('apps/synthetic-labor-os/v8-e2e-demo.mjs', ['--artifact-root', path.join(temp, 'v8'), '--repo-root', repo, '--v4-summary', v4SummaryPath, '--v5-summary', v5SummaryPath]);
  assert.equal(v8.status, 0, v8.stderr || v8.stdout);
  const v8Payload = JSON.parse(v8.stdout);
  const v9 = run('apps/synthetic-labor-os/v9-finished-claim-report.mjs', ['--artifact-root', path.join(temp, 'v9'), '--repo-root', repo, '--v0-matrix', v0MatrixPath, '--v6-summary', v8Payload.v6SummaryPath, '--v7-summary', v8Payload.v7SummaryPath, '--v8-summary', v8Payload.summaryPath]);
  assert.equal(v9.status, 0, v9.stderr || v9.stdout);
  const v10 = run('apps/synthetic-labor-os/v10-scale-smoke.mjs', ['--artifact-root', path.join(temp, 'v10'), '--repo-root', repo, '--v0-matrix', v0MatrixPath, '--v4-summary', v4SummaryPath, '--v5-summary', v5SummaryPath, '--smoke-command', 'node --version']);
  assert.equal(v10.status, 0, v10.stderr || v10.stdout);
  const v10Payload = JSON.parse(v10.stdout);
  const v11 = run('apps/synthetic-labor-os/v11-release-bundle.mjs', ['--artifact-root', path.join(temp, 'v11'), '--repo-root', repo, '--v10-summary', path.join(temp, 'v10/v10_scale_smoke_summary.json')]);
  assert.equal(v11.status, 0, v11.stderr || v11.stdout);
  const v11Payload = JSON.parse(v11.stdout);

  assert.equal(v10Payload.ok, true);
  assert.equal(v10Payload.finishedForBoundedV10Sequence, true);
  assert.match(v10Payload.truthBoundary, /does not merge, publish/);
  assert.equal(v11Payload.ok, true);
  assert.equal(v11Payload.artifactCount >= 7, true);
  assert.match(v11Payload.truthBoundary, /does not merge, publish/);
});

test('Synthetic Labor OS v13 through v15 operator and release-candidate gates pass with fixture evidence', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-v15-rc-'));
  const repo = path.join(temp, 'repo');
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs/v12-fixture.md'), '# v12 fixture\n');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
    type: 'module',
    scripts: {
      'ops:synthetic-labor-os:v10-scale-smoke': 'node x',
      'ops:synthetic-labor-os:v11-release-bundle': 'node x',
      'ops:synthetic-labor-os:v12-fresh-replay': 'node x',
      'ops:synthetic-labor-os:v13-operator-doctor': 'node x'
    }
  }, null, 2));
  const v11SummaryPath = path.join(temp, 'v11.json');
  fs.writeFileSync(v11SummaryPath, JSON.stringify({ ok: true, status: 'green_release_bundle' }, null, 2));
  const chainPath = path.join(temp, 'v12-chain.json');
  fs.writeFileSync(chainPath, JSON.stringify({ ok: true }, null, 2));
  const v12SummaryPath = path.join(temp, 'v12.json');
  fs.writeFileSync(v12SummaryPath, JSON.stringify({
    ok: true,
    status: 'green_fresh_remote_replay',
    target: 'docs/v12-fixture.md',
    freshTargetExists: true,
    chainPath
  }, null, 2));
  const stackRoot = path.join(WORKSPACE_ROOT, 'large-project-capability-stack');
  const run = (script, args = []) => spawnSync(process.execPath, [path.join(stackRoot, script), ...args], { cwd: stackRoot, encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
  const v13 = run('apps/synthetic-labor-os/v13-operator-doctor.mjs', [
    '--artifact-root', path.join(temp, 'v13'),
    '--repo-root', repo,
    '--v11-summary', v11SummaryPath,
    '--v12-summary', v12SummaryPath
  ]);
  assert.equal(v13.status, 0, v13.stderr || v13.stdout);
  const v13Payload = JSON.parse(v13.stdout);
  const v14 = run('apps/synthetic-labor-os/v14-multi-job-smoke.mjs', [
    '--artifact-root', path.join(temp, 'v14'),
    '--repo-root', repo
  ]);
  assert.equal(v14.status, 0, v14.stderr || v14.stdout);
  const v14Payload = JSON.parse(v14.stdout);
  const v15 = run('apps/synthetic-labor-os/v15-release-candidate.mjs', [
    '--artifact-root', path.join(temp, 'v15'),
    '--repo-root', repo,
    '--v11-summary', v11SummaryPath,
    '--v12-summary', v12SummaryPath,
    '--v13-summary', v13Payload.summaryPath,
    '--v14-summary', v14Payload.summaryPath,
    '--smoke-command', 'node --version'
  ]);
  assert.equal(v15.status, 0, v15.stderr || v15.stdout);
  const v15Payload = JSON.parse(v15.stdout);

  assert.equal(v13Payload.ok, true);
  assert.equal(v14Payload.appliedJobCount, 2);
  assert.equal(v14Payload.blockedConflictCount, 1);
  assert.equal(v15Payload.ok, true);
  assert.equal(v15Payload.greenEvidenceGateCount, 4);
  assert.match(v15Payload.truthBoundary, /does not merge, publish/);
});

test('Synthetic Labor OS v16 tournament scorer requires review-ready proof before ranking candidates', async () => {
  const { scoreIteration } = await import('../apps/synthetic-labor-os/v16-iteration-worker.mjs');
  const target = 'docs/v16-candidate.md';
  const green = scoreIteration({
    exitCode: 0,
    payload: { ok: true },
    target,
    proof: {
      ok: true,
      reviewReady: true,
      patchApplied: false,
      patchVerification: { gitApplyCheck: { ok: true } },
      eventSummary: { observedPositiveTokenValueTotal: 1000 },
      patchProposal: {
        targetFiles: [target],
        rationale: 'This is a sufficiently detailed rationale for the selected candidate.',
        tests: ['git apply --check patch.diff'],
        unifiedDiff: [
          'diff --git a/docs/v16-candidate.md b/docs/v16-candidate.md',
          'new file mode 100644',
          '--- /dev/null',
          '+++ b/docs/v16-candidate.md',
          '@@ -0,0 +1,3 @@',
          '+# Candidate',
          '+',
          '+Review-ready candidate.'
        ].join('\n')
      }
    }
  });
  const red = scoreIteration({
    exitCode: 0,
    payload: { ok: true },
    target,
    proof: {
      ok: true,
      reviewReady: true,
      patchApplied: false,
      patchVerification: { gitApplyCheck: { ok: true } },
      patchProposal: {
        targetFiles: ['docs/wrong.md'],
        rationale: 'wrong target',
        tests: ['test'],
        unifiedDiff: 'diff --git a/docs/wrong.md b/docs/wrong.md\n'
      }
    }
  });

  assert.equal(green.failures.length, 0);
  assert.equal(green.score > 1000, true);
  assert.equal(red.score, 0);
  assert.ok(red.failures.includes('target_mismatch'));
});

test('Synthetic Labor OS v17 role tournament verifier accepts a target-scoped scored candidate patch', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-v17-verifier-'));
  const workspace = path.join(temp, 'workspace');
  const root = path.join(workspace, 'apps/synthetic-labor-os-v17/candidate_01');
  fs.mkdirSync(path.join(root, 'role-artifacts'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'docs'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: workspace, encoding: 'utf8' });
  const target = 'docs/SYNTHETIC_LABOR_OS_V17_TEST_CANDIDATE_01.md';
  fs.writeFileSync(path.join(root, 'architecture.json'), JSON.stringify({
    id: 'candidate_01',
    title: 'Verifier fixture candidate',
    pattern: 'target-scoped operator runbook patch',
    layers: ['strategy', 'patch', 'review'],
    rationale: 'fixture rationale',
    tradeoffs: ['fixture tradeoff'],
    reviewFocus: ['target isolation'],
    candidateTarget: target
  }, null, 2));
  fs.writeFileSync(path.join(root, 'README.md'), '# Candidate\n');
  fs.writeFileSync(path.join(root, 'role-artifacts/strategy.md'), 'strategy rationale and review focus\n');
  fs.writeFileSync(path.join(root, 'candidate_patch.diff'), [
    `diff --git a/${target} b/${target}`,
    'new file mode 100644',
    'index 0000000..1111111',
    '--- /dev/null',
    `+++ b/${target}`,
    '@@ -0,0 +1,5 @@',
    '+# Synthetic Labor OS v17 Fixture',
    '+',
    '+This SLOS candidate documents operator role-agent tournament boundaries.',
    '+',
    '+It does not merge, publish, deploy, or send externally.'
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'proposal.md'), 'SLOS operator proposal with target boundary.\n');
  fs.writeFileSync(path.join(root, 'role-artifacts/patch-author-notes.md'), 'Patch notes for SLOS operator.\n');
  fs.mkdirSync(path.join(workspace, 'tests/synthetic-labor-os-v17'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'tests/synthetic-labor-os-v17/candidate_01.test-plan.md'), 'Validate with git apply --check, target isolation, truth boundary, and SLOS test gate.\n');
  fs.writeFileSync(path.join(root, 'role-artifacts/test-plan.md'), 'git apply target truth validation SLOS\n');
  fs.writeFileSync(path.join(root, 'role-artifacts/adversarial-review.md'), 'Risk counterexample verdict target claim honesty.\n');
  fs.writeFileSync(path.join(root, 'role-artifacts/adversarial-review.json'), JSON.stringify({ verdict: 'accept', risks: ['scope drift'], counterexamples: ['wrong target'] }, null, 2));
  fs.writeFileSync(path.join(root, 'role-artifacts/scorecard.json'), JSON.stringify({
    score: 91,
    strengths: ['clear target', 'honest boundary'],
    weaknesses: ['docs only'],
    rationale: 'Good role-agent tournament documentation patch.',
    candidateTarget: target,
    shouldWin: true
  }, null, 2));
  fs.writeFileSync(path.join(root, 'role-artifacts/refinement-notes.md'), 'score strength weakness rationale winner recommendation\n');
  const verifier = path.join(WORKSPACE_ROOT, 'large-project-capability-stack/apps/synthetic-labor-os/v17-role-verifier.mjs');
  const patchRun = spawnSync(process.execPath, [verifier, 'patch', workspace, 'candidate_01::scorer_refiner'], { cwd: workspace, encoding: 'utf8' });
  const scoreRun = spawnSync(process.execPath, [verifier, 'score', workspace, 'candidate_01::scorer_refiner'], { cwd: workspace, encoding: 'utf8' });

  assert.equal(patchRun.status, 0, patchRun.stderr || patchRun.stdout);
  assert.equal(scoreRun.status, 0, scoreRun.stderr || scoreRun.stdout);
  const score = JSON.parse(scoreRun.stdout);
  assert.equal(score.ok, true);
  assert.equal(score.metadata.patch.diffPaths[0], target);
  assert.equal(score.metadata.finalScore >= 91, true);
});

test('Synthetic Labor OS v18 verifier requires whole-OS runtime and test patch, not docs-only output', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slos-v18-verifier-'));
  const sourceRepo = path.join(temp, 'source');
  const workspace = path.join(temp, 'workspace');
  const candidateRoot = path.join(workspace, 'apps/synthetic-labor-os-v18/candidate_01');
  fs.mkdirSync(path.join(candidateRoot, 'role-artifacts'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'tests/synthetic-labor-os-v18'), { recursive: true });
  fs.mkdirSync(path.join(sourceRepo, 'apps/synthetic-labor-os'), { recursive: true });
  fs.mkdirSync(path.join(sourceRepo, 'packages/synthetic-labor-os'), { recursive: true });
  fs.mkdirSync(path.join(sourceRepo, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(sourceRepo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(sourceRepo, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
  fs.writeFileSync(path.join(sourceRepo, 'apps/synthetic-labor-os/operator-dashboard.mjs'), [
    'export function renderDashboard() {',
    "  return 'ok';",
    '}',
    ''
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(sourceRepo, 'packages/synthetic-labor-os/index.mjs'), 'export const syntheticLaborOsFixture = true;\n');
  fs.writeFileSync(path.join(sourceRepo, 'tests/synthetic-labor-os.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('fixture baseline', () => { assert.equal(1, 1); });",
    ''
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(sourceRepo, 'tests/synthetic-labor-os-remote-smoke.test.mjs'), "import test from 'node:test';\ntest('remote smoke fixture', () => {});\n");
  fs.writeFileSync(path.join(sourceRepo, 'docs/SYNTHETIC_LABOR_OS_V0.md'), '# Fixture docs\n');
  fs.writeFileSync(path.join(workspace, 'v18_source_manifest.json'), JSON.stringify({
    sourceRepoPath: sourceRepo,
    validationCommands: ['node --test tests/synthetic-labor-os.test.mjs']
  }, null, 2));
  fs.writeFileSync(path.join(candidateRoot, 'architecture.json'), JSON.stringify({
    id: 'candidate_01',
    title: 'Whole OS verifier fixture',
    theme: 'operator command center for live jobs',
    proposedRuntimeChange: 'add status helper',
    affectedFiles: ['apps/synthetic-labor-os/operator-dashboard.mjs', 'tests/synthetic-labor-os.test.mjs'],
    tests: ['node --test tests/synthetic-labor-os.test.mjs'],
    risks: ['fixture only']
  }, null, 2));
  fs.writeFileSync(path.join(candidateRoot, 'README.md'), 'Runtime and test fixture candidate.\n');
  fs.writeFileSync(path.join(candidateRoot, 'role-artifacts/systems-architect-brief.md'), 'Change runtime and test files, not docs only.\n');
  fs.writeFileSync(path.join(candidateRoot, 'whole_os_candidate.patch'), [
    'diff --git a/apps/synthetic-labor-os/operator-dashboard.mjs b/apps/synthetic-labor-os/operator-dashboard.mjs',
    'index 5c8f8ef..94a83c5 100644',
    '--- a/apps/synthetic-labor-os/operator-dashboard.mjs',
    '+++ b/apps/synthetic-labor-os/operator-dashboard.mjs',
    '@@ -1,4 +1,8 @@',
    ' export function renderDashboard() {',
    "   return 'ok';",
    ' }',
    '+',
    '+export function renderV18FixtureStatus() {',
    "+  return 'whole-os runtime proof boundary';",
    '+}',
    ' ',
    'diff --git a/tests/synthetic-labor-os.test.mjs b/tests/synthetic-labor-os.test.mjs',
    'index 092c0ad..c6ce7a3 100644',
    '--- a/tests/synthetic-labor-os.test.mjs',
    '+++ b/tests/synthetic-labor-os.test.mjs',
    '@@ -1,4 +1,5 @@',
    " import test from 'node:test';",
    " import assert from 'node:assert/strict';",
    " test('fixture baseline', () => { assert.equal(1, 1); });",
    "+test('v18 whole-os fixture evidence', () => { assert.match('truth boundary provenance', /truth boundary/); });",
    ' '
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(candidateRoot, 'proposal.md'), 'Whole OS runtime proposal with tests and truth boundary.\n');
  fs.writeFileSync(path.join(candidateRoot, 'role-artifacts/runtime-implementer-notes.md'), 'Runtime patch touches SLOS dashboard and tests.\n');
  fs.writeFileSync(path.join(workspace, 'tests/synthetic-labor-os-v18/candidate_01.test-plan.md'), 'Run node --test tests/synthetic-labor-os.test.mjs after applying the patch.\n');
  fs.writeFileSync(path.join(candidateRoot, 'role-artifacts/test-engineer-notes.md'), 'Validation covers runtime behavior and test evidence.\n');
  fs.writeFileSync(path.join(candidateRoot, 'role-artifacts/adversarial-review.md'), 'Risk counterexample verdict: not docs-only, runtime and test paths are present.\n');
  fs.writeFileSync(path.join(candidateRoot, 'role-artifacts/adversarial-review.json'), JSON.stringify({ verdict: 'accept', risks: ['fixture only'], counterexamples: ['docs-only patch rejected'] }, null, 2));
  fs.writeFileSync(path.join(candidateRoot, 'role-artifacts/scorecard.json'), JSON.stringify({
    score: 92,
    strengths: ['runtime path changed', 'test path changed'],
    weaknesses: ['fixture only'],
    rationale: 'Valid whole-OS runtime and test candidate.',
    changedRuntimeFiles: ['apps/synthetic-labor-os/operator-dashboard.mjs'],
    changedTestFiles: ['tests/synthetic-labor-os.test.mjs'],
    validationCommand: 'node --test tests/synthetic-labor-os.test.mjs',
    shouldWin: true
  }, null, 2));
  fs.writeFileSync(path.join(candidateRoot, 'role-artifacts/refinement-notes.md'), 'Final score includes runtime and test evidence.\n');
  const verifier = path.join(WORKSPACE_ROOT, 'large-project-capability-stack/apps/synthetic-labor-os/v18-whole-os-verifier.mjs');
  const patchRun = spawnSync(process.execPath, [verifier, 'patch', workspace, 'candidate_01::release_scorer'], { cwd: workspace, encoding: 'utf8' });
  const validationRun = spawnSync(process.execPath, [verifier, 'validation', workspace, 'candidate_01::release_scorer'], { cwd: workspace, encoding: 'utf8' });
  const scoreRun = spawnSync(process.execPath, [verifier, 'score', workspace, 'candidate_01::release_scorer'], { cwd: workspace, encoding: 'utf8' });

  assert.equal(patchRun.status, 0, patchRun.stderr || patchRun.stdout);
  assert.equal(validationRun.status, 0, validationRun.stderr || validationRun.stdout);
  assert.equal(scoreRun.status, 0, scoreRun.stderr || scoreRun.stdout);
  const score = JSON.parse(scoreRun.stdout);
  assert.equal(score.ok, true);
  assert.deepEqual(score.metadata.runtimePaths, ['apps/synthetic-labor-os/operator-dashboard.mjs']);
  assert.deepEqual(score.metadata.testPaths, ['tests/synthetic-labor-os.test.mjs']);

  fs.writeFileSync(path.join(candidateRoot, 'whole_os_candidate.patch'), [
    'diff --git a/docs/SYNTHETIC_LABOR_OS_V0.md b/docs/SYNTHETIC_LABOR_OS_V0.md',
    'index 1111111..2222222 100644',
    '--- a/docs/SYNTHETIC_LABOR_OS_V0.md',
    '+++ b/docs/SYNTHETIC_LABOR_OS_V0.md',
    '@@ -1 +1,2 @@',
    ' # Fixture docs',
    '+Docs-only truth boundary note.'
  ].join('\n') + '\n');
  const docsOnlyRun = spawnSync(process.execPath, [verifier, 'patch-shape', workspace, 'candidate_01::release_scorer'], { cwd: workspace, encoding: 'utf8' });
  assert.notEqual(docsOnlyRun.status, 0, docsOnlyRun.stdout);
});
