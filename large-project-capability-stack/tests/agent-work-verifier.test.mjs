import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCompletionPacket,
  buildCompletionTruthPacket,
  buildTerminalBlockerPacket,
  buildVerifierAdapter,
  buildVerifierMatrix,
  compileObjective,
  createVerificationContext,
  runVerifierAdapter,
  validateVerifierEvidence,
  verifyRun,
  writePhase6TruthArtifacts
} from '../packages/canonical-agent-work/index.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/agent-work-v1/v0-cortex-handoff.json'), 'utf8'));

function tmpDir(label = 'agent-work-verifier-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function makeRepo() {
  const repo = tmpDir('phase6-source-');
  write(path.join(repo, 'src/product.mjs'), 'export const value = "before";\n');
  return repo;
}

function makePatchBundle({ before = 'export const value = "before";\n', after = 'export const value = "before";\nexport const verified = true;\n' } = {}) {
  return {
    schemaVersion: 'clawd.agent_work.phase5_patch_bundle.v1',
    patchId: 'patch-phase6-fixture',
    ok: true,
    modifiedFiles: [{
      path: 'src/product.mjs',
      beforeExists: true,
      beforeSha256: sha256(before),
      beforeContent: before,
      afterExists: true,
      afterSha256: sha256(after),
      afterContent: after
    }]
  };
}

function greenWorkerPacket() {
  return {
    schemaVersion: 'clawd.agent_work.phase5_worker_execution_packet.v1',
    status: 'green',
    checks: { packetGreen: true },
    digest: 'worker-packet-digest'
  };
}

test('Phase 6 runs independent verifier commands in clean source/patch digest-bound contexts', () => {
  const repo = makeRepo();
  const patchBundle = makePatchBundle();
  const context = createVerificationContext({ sourceRoot: repo, patchBundle, contextRoot: tmpDir('phase6-context-'), verifierId: 'deterministic-product-check', allowedFiles: ['src/product.mjs'] });
  assert.equal(context.isolated, true);
  assert.match(fs.readFileSync(path.join(context.workspacePath, 'src/product.mjs'), 'utf8'), /verified = true/);

  const adapter = buildVerifierAdapter({
    verifierId: 'deterministic-product-check',
    type: 'deterministic_command',
    command: process.execPath,
    args: ['-e', 'const fs=require("fs"); const text=fs.readFileSync("src/product.mjs","utf8"); if(!/verified = true/.test(text)) process.exit(7);'],
    actorRole: 'independent_verifier'
  });
  assert.equal(adapter.validation.ok, true);
  const evidence = runVerifierAdapter({ adapter, context });
  assert.equal(evidence.ok, true);
  const validation = validateVerifierEvidence(evidence, { expectedSourceDigest: context.sourceDigest, expectedPatchDigest: context.patchDigest, expectedContextDigest: context.contextDigest });
  assert.equal(validation.ok, true);
  assert.equal(validation.checks.find((check) => check.id === 'evidence_digest_matches').ok, true);

  const stale = validateVerifierEvidence(evidence, { expectedSourceDigest: context.sourceDigest, expectedPatchDigest: 'wrong-patch-digest', expectedContextDigest: context.contextDigest });
  assert.equal(stale.ok, false);
  assert.equal(stale.checks.find((check) => check.id === 'patch_digest_bound').ok, false);
});

test('Phase 6 supports schema/static, runtime, browser/visual packet, and manual-review verifier adapter types', () => {
  const repo = makeRepo();
  const patchBundle = makePatchBundle();
  const context = createVerificationContext({ sourceRoot: repo, patchBundle, contextRoot: tmpDir('phase6-types-'), verifierId: 'types', allowedFiles: ['src/product.mjs'] });
  const schemaStatic = buildVerifierAdapter({ verifierId: 'schema-static', type: 'schema_static', command: process.execPath, args: ['-e', 'process.exit(0)'] });
  const runtime = buildVerifierAdapter({ verifierId: 'runtime', type: 'runtime_integration', command: process.execPath, args: ['-e', 'process.exit(0)'] });
  const visual = buildVerifierAdapter({ verifierId: 'visual', type: 'browser_visual', manualPacket: { decision: 'approved', reviewer: 'independent-visual-reviewer', nonWorkerReview: true, boundDigest: context.patchDigest } });
  const manual = buildVerifierAdapter({ verifierId: 'manual', type: 'manual_review_packet', manualPacket: { decision: 'approved', reviewer: 'independent-reviewer', nonWorkerReview: true, boundDigest: context.patchDigest } });
  for (const adapter of [schemaStatic, runtime, visual, manual]) assert.equal(adapter.validation.ok, true, adapter.verifierId);
  const visualEvidence = runVerifierAdapter({ adapter: visual, context });
  const manualEvidence = runVerifierAdapter({ adapter: manual, context });
  assert.equal(visualEvidence.ok, true);
  assert.equal(manualEvidence.ok, true);
  assert.equal(validateVerifierEvidence(manualEvidence, { expectedPatchDigest: context.patchDigest }).ok, true);
});

test('Phase 6 rejects worker self-report and forged/stale verifier evidence', () => {
  const repo = makeRepo();
  const context = createVerificationContext({ sourceRoot: repo, patchBundle: makePatchBundle(), contextRoot: tmpDir('phase6-reject-'), verifierId: 'reject', allowedFiles: ['src/product.mjs'] });
  const workerAdapter = buildVerifierAdapter({ verifierId: 'worker-self-report', type: 'manual_review_packet', actorRole: 'worker', manualPacket: { decision: 'approved', reviewer: 'worker', nonWorkerReview: false, boundDigest: context.patchDigest } });
  assert.equal(workerAdapter.validation.ok, false);
  const forgedEvidence = {
    schemaVersion: 'clawd.agent_work.phase6_verifier_evidence.v1',
    verifierId: 'forged',
    type: 'manual_review_packet',
    actorRole: 'worker',
    independent: false,
    ok: true,
    skipped: false,
    runtimeMs: 1,
    timedOut: false,
    context: { sourceDigest: context.sourceDigest, patchDigest: context.patchDigest, contextDigest: 'wrong-context' },
    evidenceDigest: 'not-a-real-digest'
  };
  const validation = validateVerifierEvidence(forgedEvidence, { expectedSourceDigest: context.sourceDigest, expectedPatchDigest: context.patchDigest, expectedContextDigest: context.contextDigest });
  assert.equal(validation.ok, false);
  assert.equal(validation.checks.find((check) => check.id === 'independent_not_worker').ok, false);
  assert.equal(validation.checks.find((check) => check.id === 'context_digest_bound').ok, false);
  assert.equal(validation.checks.find((check) => check.id === 'evidence_digest_matches').ok, false);
});

test('Phase 6 completion truth blocks mechanical green over red objective truth and matrix green over failed claim ledger', () => {
  const verifierMatrix = buildVerifierMatrix({ verifierResults: [{ verifierId: 'v1', type: 'deterministic_command', ok: true, skipped: false, independent: true, evidenceDigest: 'evidence' }] });
  assert.equal(verifierMatrix.status, 'green');
  const contradiction = buildCompletionTruthPacket({
    runId: 'phase6-contradiction',
    workerExecutionPacket: greenWorkerPacket(),
    verifierMatrix,
    claimLedger: { summary: { status: 'red', completionEligible: false, claimCount: 1, counterclaimedCount: 1 } },
    objectiveTruth: { status: 'green', ok: true },
    mechanicalGreen: false
  });
  assert.equal(contradiction.status, 'blocked');
  assert.equal(contradiction.blocker.code, 'matrix_green_claim_ledger_red');

  const redObjective = buildCompletionTruthPacket({
    runId: 'phase6-objective-red',
    workerExecutionPacket: greenWorkerPacket(),
    verifierMatrix,
    claimLedger: { summary: { status: 'green', completionEligible: true, claimCount: 1, counterclaimedCount: 0 } },
    objectiveTruth: { status: 'red', ok: false },
    mechanicalGreen: true
  });
  assert.equal(redObjective.status, 'blocked');
  assert.equal(redObjective.blocker.code, 'mechanical_green_objective_red');
  assert.equal(redObjective.completionClaimAllowed, false);
});

test('Phase 6 terminal green requires hashed worker/verifier/claim/objective evidence and exact allowed claims', () => {
  const verifierMatrix = buildVerifierMatrix({ verifierResults: [{ verifierId: 'v1', type: 'deterministic_command', ok: true, skipped: false, independent: true, evidenceDigest: 'evidence' }] });
  const packet = buildCompletionTruthPacket({
    runId: 'phase6-green',
    workerExecutionPacket: greenWorkerPacket(),
    verifierMatrix,
    claimLedger: { summary: { status: 'green', completionEligible: true, claimCount: 1, counterclaimedCount: 0 } },
    objectiveTruth: { status: 'green', ok: true },
    mechanicalGreen: true,
    requestedClaims: ['bounded_verified_worker_progress']
  });
  assert.equal(packet.status, 'green');
  assert.equal(packet.completionClaimAllowed, true);
  assert.deepEqual(packet.allowedClaims, ['bounded_verified_worker_progress']);
  assert.match(packet.digest, /^[a-f0-9]{64}$/);
  assert.equal(packet.terminalClaim.completionClaimAllowed, true);

  const blocker = buildTerminalBlockerPacket({ runId: 'phase6-red', code: 'terminal_red_fixture', summary: 'Terminal red fixture', observedEvidence: ['objectiveTruth=red'] });
  assert.equal(blocker.terminal, true);
  assert.equal(blocker.retryable, true);
});

test('Phase 6 facade verify/report surface truth packets and exact claims', () => {
  const runRoot = tmpDir('phase6-facade-');
  const planned = compileObjective({ input: fixture, outputDir: runRoot, config: { executionBoundary: 'control_plane_allowed' } });
  assert.equal(planned.ok, true);
  const verifierMatrix = buildVerifierMatrix({ verifierResults: [{ verifierId: 'facade-v1', type: 'deterministic_command', ok: true, skipped: false, independent: true, evidenceDigest: 'evidence' }] });
  const truth = buildCompletionTruthPacket({
    runId: planned.runId,
    workerExecutionPacket: greenWorkerPacket(),
    verifierMatrix,
    claimLedger: { summary: { status: 'green', completionEligible: true, claimCount: 1, counterclaimedCount: 0 } },
    objectiveTruth: { status: 'green', ok: true },
    requestedClaims: ['bounded_verified_worker_progress']
  });
  writePhase6TruthArtifacts(truth, path.join(runRoot, 'phase6_truth'));
  const verify = verifyRun({ runRoot });
  assert.equal(verify.ok, true);
  assert.equal(verify.data.verification.phase6TruthGreen, true);
  assert.equal(verify.data.verification.completionClaimAllowed, true);
  assert.deepEqual(verify.data.verification.allowedClaims, ['bounded_verified_worker_progress']);
  const report = buildCompletionPacket({ runRoot });
  assert.equal(report.data.report.schemaVersion, 'clawd.agent_work.phase8_report.v1');
  assert.equal(report.data.report.phase6TruthGreen, true);
  assert.equal(report.data.report.completionClaimAllowed, true);
  assert.deepEqual(report.data.report.allowedClaims, ['bounded_verified_worker_progress']);
  assert.equal(report.data.report.phase7OpsGreen, false);
});
