import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateClaimLedger,
  attachVerifierProof,
  buildProofCarryingClaimLedger,
  createAdversarialChallenge,
  createPatchClaim,
  deriveMergeEligibility,
  evaluateProofCarryingPatchClaim,
  normalizeProofCarryingPatchClaim,
  recordChallengeOutcome
} from '../packages/proof-carrying-claim-ledger/index.mjs';
import {
  createArtifactBus,
  createPatchQueue,
  compileSupervisorSnapshot,
  enqueuePatch,
  processPatchQueue,
  buildShardPlan
} from '../packages/multi-agent-orchestrator/index.mjs';

const assignmentContract = {
  artifactKind: 'product_diff',
  targetFiles: ['packages/app/domain-editor.mjs'],
  targetModules: ['packages/app/domain-editor.mjs'],
  verifierRequirements: ['tests'],
  successPredicate: ['editor reducer persists through the real runtime']
};

function claimedPatch(overrides = {}) {
  return {
    id: overrides.id || 'patch-rich-editor-claim',
    shardId: overrides.shardId || 'rich-editor-runtime',
    taskId: overrides.taskId || 'rich-editor-runtime',
    agentId: overrides.agentId || 'agent-builder-17',
    filePaths: ['packages/app/domain-editor.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract,
      surfaceIds: ['email_builder'],
      implementation: {
        modifiedFiles: ['packages/app/domain-editor.mjs']
      },
      hierarchicalPlanningEvidence: {
        sourceOfTruthIntegrated: true,
        negativeSpaceReduced: true,
        reducedGaps: ['static editor forms now have reducer-backed command state'],
        remainingGaps: 'drag/drop geometry and visual site designer parity remain',
        proofArtifacts: ['tests/campaign-rich-client-editor.test.mjs']
      },
      proofCarryingClaim: {
        statement: 'Reducer command state reduces the rich editor client architecture gap.',
        reducedGaps: ['rich client editor command runtime'],
        remainingGaps: 'drag/drop geometry and production-grade visual builder parity',
        sourceOfTruthIntegrated: true,
        counterexamplesConsidered: [
          'static page markup without command mutation would not count',
          'tests-only scaffolding would not count',
          'a patch outside the editor runtime would not count'
        ],
        proofArtifacts: ['tests/campaign-rich-client-editor.test.mjs']
      },
      ...(overrides.metadata || {})
    }
  };
}

test('proof-carrying claim ledger turns a patch into evidence, adversarial challenges, and surviving credit', async () => {
  const patch = claimedPatch();
  const admission = {
    ok: true,
    details: {
      assignmentContract,
      modifiedFiles: patch.metadata.implementation.modifiedFiles,
      touchedTargetFiles: ['packages/app/domain-editor.mjs'],
      admissibleVerifierEvidence: true
    }
  };
  const evaluation = await evaluateProofCarryingPatchClaim(patch, {
    admission,
    verifierResults: [{ verifier: 'tests', ok: true }]
  });
  assert.equal(evaluation.survived, true);
  assert.equal(evaluation.record.status, 'survived');
  assert.equal(evaluation.record.summary.fatalSustainedChallengeCount, 0);
  assert.equal(evaluation.record.challenges.every((challenge) => challenge.status === 'survived'), true);

  const ledger = buildProofCarryingClaimLedger({ records: [evaluation.record] });
  assert.equal(ledger.summary.status, 'green');
  assert.equal(ledger.summary.completionEligible, true);
  assert.equal(ledger.bySurface[0].surfaceId, 'email_builder');
});

test('proof-carrying claim gate rejects patches that cannot name gap reduction, runtime integration, and counterexamples', async () => {
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, {
    ...claimedPatch({ id: 'patch-shallow-claim', shardId: 'shallow-runtime', taskId: 'shallow-runtime' }),
    metadata: {
      assignmentContract,
      surfaceIds: ['email_builder'],
      implementation: { modifiedFiles: ['packages/app/domain-editor.mjs'] },
      proofCarryingClaim: {
        statement: 'This should not survive without adversarial evidence.'
      }
    }
  });

  const processed = await processPatchQueue(queue, {
    proofCarryingClaims: true,
    verifyFns: { tests: async () => ({ ok: true }) }
  });

  assert.equal(processed.queue.merged.length, 0);
  assert.equal(processed.queue.rejected.length, 1);
  assert.equal(processed.queue.rejected[0].rejectionCategory, 'claim_integrity');
  assert.match(processed.queue.rejected[0].rejectionReason, /proof_carrying_claim_failed/);
  assert.equal(processed.claimLedger.summary.status, 'red');
  assert.equal(processed.claimLedger.records[0].summary.fatalSustainedChallengeIds.includes('negative_space_reduced'), true);
  assert.equal(processed.claimLedger.records[0].summary.fatalSustainedChallengeIds.includes('source_of_truth_integrated'), true);
  assert.equal(processed.claimLedger.records[0].summary.fatalSustainedChallengeIds.includes('counterexamples_named'), true);
});

test('patch queue integrates surviving proof-carrying claims into supervisor-visible ledger state', async () => {
  const workGraph = {
    targetPath: '/tmp/mailclone',
    workUnits: [{
      id: 'rich-editor-runtime',
      title: 'Rich editor runtime',
      lane: 'frontend_architecture',
      domain: 'email_builder',
      fileAreas: ['packages/app/domain-editor.mjs'],
      allowedFiles: ['packages/app/domain-editor.mjs'],
      acceptanceChecks: ['editor reducer persists through the real runtime'],
      requiredVerifiers: ['tests'],
      metadata: { assignmentContract }
    }]
  };
  const shardPlan = buildShardPlan({ workGraph, surfaceMatrix: { surfaces: [] } });
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, claimedPatch());

  const processed = await processPatchQueue(queue, {
    proofCarryingClaims: true,
    verifyFns: { tests: async () => ({ ok: true }) }
  });

  assert.equal(processed.queue.merged.length, 1);
  assert.equal(processed.queue.merged[0].proofCarryingClaimRecord.status, 'survived');
  assert.equal(processed.queue.claimLedger.summary.status, 'green');
  assert.equal(processed.decisions[0].claimLedgerRecord.creditStatus, 'surviving_credit');

  const supervisor = compileSupervisorSnapshot({
    shardPlan,
    patchQueue: processed.queue,
    artifactBus: createArtifactBus()
  });
  assert.equal(supervisor.topLevel.status, 'green');
  assert.equal(supervisor.claimLedger.summary.status, 'green');
  assert.equal(supervisor.claimLedger.summary.completionEligible, true);
});

test('normalized claims remain explicit about generated counterexamples versus builder-provided counterexamples', () => {
  const patch = claimedPatch({ metadata: { proofCarryingClaim: { statement: 'thin claim' } } });
  const claim = normalizeProofCarryingPatchClaim(patch, {
    admission: {
      ok: true,
      details: {
        assignmentContract,
        modifiedFiles: ['packages/app/domain-editor.mjs'],
        touchedTargetFiles: ['packages/app/domain-editor.mjs'],
        admissibleVerifierEvidence: true
      }
    },
    verifierResults: [{ verifier: 'tests', ok: true }]
  });
  assert.deepEqual(claim.counterexamplesConsidered, []);
  assert.equal(Array.isArray(claim.generatedCounterexamples), true);
});

test('stable claim-ledger APIs create claims, attach proof, record challenges, aggregate, and derive eligibility', () => {
  const patch = claimedPatch();
  const claim = createPatchClaim(patch, {
    admission: {
      ok: true,
      details: {
        assignmentContract,
        modifiedFiles: ['packages/app/domain-editor.mjs'],
        touchedTargetFiles: ['packages/app/domain-editor.mjs']
      }
    }
  });
  const provenClaim = attachVerifierProof(claim, { verifier: 'tests', ok: true });
  assert.equal(provenClaim.evidence.nonSkippedVerifierPass, true);

  const survivedChallenge = createAdversarialChallenge({
    id: 'runtime_path_proven',
    passed: true,
    question: 'Did the runtime path consume the change?'
  });
  const record = recordChallengeOutcome(provenClaim, survivedChallenge);
  assert.equal(record.status, 'survived');

  const ledger = aggregateClaimLedger({ records: [record] });
  assert.equal(ledger.summary.status, 'green');
  assert.equal(deriveMergeEligibility({ record }).eligible, true);

  const failed = recordChallengeOutcome(provenClaim, createAdversarialChallenge({
    id: 'missing_runtime_delta',
    passed: false,
    question: 'Is there a runtime delta?',
    evidence: { runtimeDelta: false }
  }));
  assert.equal(failed.status, 'counterclaimed');
  assert.equal(deriveMergeEligibility({ record: failed }).eligible, false);
});

test('claim-ledger audit_only mode records counterclaims without blocking merge credit', async () => {
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, {
    ...claimedPatch({ id: 'patch-audit-only-thin-claim', shardId: 'audit-only-runtime', taskId: 'audit-only-runtime' }),
    metadata: {
      assignmentContract,
      surfaceIds: ['email_builder'],
      implementation: { modifiedFiles: ['packages/app/domain-editor.mjs'] },
      proofCarryingClaim: {
        statement: 'Audit-only should preserve the warning while allowing the patch.'
      }
    }
  });

  const processed = await processPatchQueue(queue, {
    proofCarryingClaims: true,
    claimLedgerPolicy: { mode: 'audit_only' },
    verifyFns: { tests: async () => ({ ok: true }) }
  });

  assert.equal(processed.queue.merged.length, 1);
  assert.equal(processed.queue.rejected.length, 0);
  assert.equal(processed.queue.merged[0].claimLedgerAuditOnly, true);
  assert.equal(processed.claimLedger.summary.status, 'red');
  assert.equal(deriveMergeEligibility({ record: processed.queue.merged[0].proofCarryingClaimRecord }, { mode: 'audit_only' }).eligible, true);
});
