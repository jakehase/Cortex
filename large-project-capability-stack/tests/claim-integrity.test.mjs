import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileClaimIntegrityReport,
  compileBenchmarkRunClaimIntegrityAudit,
  evaluateBenchmarkRunClaimPreflight,
  buildAdversarialAudit,
  buildClaimResponseFrame
} from '../packages/claim-integrity/index.mjs';

function makeLeaf(id, currentState, evidence = {}) {
  return {
    id,
    label: id,
    currentState,
    evidence: {
      targetReference: evidence.targetReference || 'roadmap.md',
      changedProductFiles: evidence.changedProductFiles || ['/repo/packages/app/example.mjs'],
      proofArtifacts: evidence.proofArtifacts || ['/repo/artifacts/example.json'],
      confidence: evidence.confidence ?? 0.8,
      missingAdjacent: evidence.missingAdjacent || []
    }
  };
}

test('leaf-level negative space keeps clone estimates in the single digits when most of the real product is missing', () => {
  const surfaces = Array.from({ length: 16 }, (_, index) => {
    const id = `surface_${index + 1}`;
    const partial = index < 7;
    return {
      id,
      label: id,
      weight: 1,
      leaves: partial
        ? [
            makeLeaf(`${id}.leaf_1`, 'workflow_partial', { missingAdjacent: ['deep edge cases', 'real browser proof'] }),
            makeLeaf(`${id}.leaf_2`, 'route_only', { missingAdjacent: ['persistence', 'reporting drill-down'] }),
            makeLeaf(`${id}.leaf_3`, 'missing', { changedProductFiles: [], proofArtifacts: [], confidence: 0.3, missingAdjacent: ['whole workflow family'] }),
            makeLeaf(`${id}.leaf_4`, 'missing', { changedProductFiles: [], proofArtifacts: [], confidence: 0.3, missingAdjacent: ['whole workflow family'] }),
            makeLeaf(`${id}.leaf_5`, 'missing', { changedProductFiles: [], proofArtifacts: [], confidence: 0.3, missingAdjacent: ['whole workflow family'] })
          ]
        : [
            makeLeaf(`${id}.leaf_1`, 'missing', { changedProductFiles: [], proofArtifacts: [], confidence: 0.2, missingAdjacent: ['entire surface missing'] }),
            makeLeaf(`${id}.leaf_2`, 'missing', { changedProductFiles: [], proofArtifacts: [], confidence: 0.2, missingAdjacent: ['entire surface missing'] }),
            makeLeaf(`${id}.leaf_3`, 'missing', { changedProductFiles: [], proofArtifacts: [], confidence: 0.2, missingAdjacent: ['entire surface missing'] }),
            makeLeaf(`${id}.leaf_4`, 'missing', { changedProductFiles: [], proofArtifacts: [], confidence: 0.2, missingAdjacent: ['entire surface missing'] }),
            makeLeaf(`${id}.leaf_5`, 'missing', { changedProductFiles: [], proofArtifacts: [], confidence: 0.2, missingAdjacent: ['entire surface missing'] })
          ]
    };
  });

  const report = compileClaimIntegrityReport({
    title: 'mailchimp_like_clone',
    requestedFidelity: 'full_clone',
    executionReadiness: {
      control_plane_ready: 1,
      execution_plane_ready: 1,
      supervisor_truth: 0.8,
      notifier_truth: 0.8,
      repo_qualification: 0.9,
      recovery_proven: 0.8,
      no_null_blocker_contradiction: 0.4
    },
    surfaces
  });

  assert.equal(report.axes.executionReadiness > 0.8, true);
  assert.equal(report.progress.cloneParityPercent > 0, true);
  assert.equal(report.progress.cloneParityPercent < 10, true);
  assert.equal(report.negativeSpace.criticalEntries > 40, true);
  assert.equal(report.adversarialAudit.reasonsEstimateMayBeTooHigh.includes('execution_readiness_outpaces_product_parity'), true);
});

test('adversarial audit rejects overly optimistic percentages and flags missing evidence lineage', () => {
  const report = compileClaimIntegrityReport({
    title: 'optimism_check',
    requestedFidelity: 'full_clone',
    executionReadiness: {
      control_plane_ready: 1,
      execution_plane_ready: 1,
      supervisor_truth: 1,
      notifier_truth: 1,
      repo_qualification: 1,
      recovery_proven: 1,
      no_null_blocker_contradiction: 1
    },
    surfaces: [
      {
        id: 'campaigns',
        label: 'Campaigns',
        leaves: [
          {
            id: 'campaigns.builder',
            currentState: 'persisted_partial',
            evidence: {
              targetReference: 'roadmap.md',
              changedProductFiles: ['/repo/packages/app/routes/campaigns.mjs'],
              proofArtifacts: [],
              confidence: 0.5,
              missingAdjacent: ['send preparation', 'edge cases']
            }
          },
          {
            id: 'campaigns.delivery',
            currentState: 'missing',
            evidence: {
              targetReference: 'roadmap.md',
              changedProductFiles: [],
              proofArtifacts: [],
              confidence: 0.2,
              missingAdjacent: ['whole delivery workflow']
            }
          }
        ]
      }
    ]
  });

  const audit = buildAdversarialAudit(report, { proposedPercent: 40 });
  assert.equal(audit.reasonsEstimateMayBeTooHigh.includes('proposed_percent_exceeds_artifact_backed_estimate'), true);
  assert.equal(audit.reasonsEstimateMayBeTooHigh.includes('evidence_lineage_is_incomplete'), true);

  const frame = buildClaimResponseFrame(report, { proposedPercent: 40 });
  assert.ok(frame.observed.axes);
  assert.ok(frame.estimated);
  assert.ok(frame.confidence);
  assert.ok(Array.isArray(frame.missing));
  assert.ok(frame.higherEstimateRequirements['10']);
});

test('benchmark claim audit downgrades deterministic strict-runtime green for real Codex product claims', () => {
  const contract = {
    benchmarkId: 'mailchimp_100agent_product_parity_strict_validator_30m',
    runId: 'strict-deterministic-fixture',
    requestedAgentCount: 2,
    metadata: { requestedClaim: 'real_codex_product_work' },
    scope: { durationTargetMinutes: 30, productDiffMode: 'semantic_product_architecture' }
  };
  const resultRecords = ['surface_a', 'surface_b'].map((surfaceId) => ({
    ok: true,
    shardId: surfaceId,
    agentId: `agent-${surfaceId}`,
    elapsedMs: 1_800_750,
    implementation: {
      ok: true,
      command: null,
      durationMs: 0,
      firstMeaningfulProgressMs: 0,
      modifiedFiles: [`packages/app/${surfaceId}.mjs`],
      metadata: {
        benchmarkMode: 'strict_product_surface_runtime',
        productDiffMode: 'semantic_product_architecture',
        strictProductSurfaceRuntime: true
      }
    },
    verifierResults: [
      { ok: true, verifier: `${surfaceId}__semantic_runtime`, durationMs: 1_800_125 }
    ]
  }));

  const audit = compileBenchmarkRunClaimIntegrityAudit({
    contract,
    resultRecords,
    thresholdPass: true,
    mechanicalGreen: true,
    scaleProofReady: true,
    tokenEvidence: { ledgerPresent: false, codexCallsStarted: 0, codexCallsCompleted: 0, tokensObserved: 0 },
    durationEvidence: { durationTargetMinutes: 30 }
  });

  assert.equal(audit.requestedClaim, 'real_codex_product_work');
  assert.equal(audit.requestedClaimAllowed, false);
  assert.equal(audit.status, 'claim_blocked');
  assert.equal(audit.highestHonestClaim, 'deterministic_strict_runtime');
  assert.equal(audit.fakeGreenRisk, true);
  assert.equal(audit.observed.deterministicImplementationCount, 2);
  assert.equal(audit.observed.verifierOnlyDurationSuspect, true);
  assert.equal(audit.blockingFailures.some((check) => check.id === 'real_codex_implementation_commands_present'), true);
  assert.equal(audit.blockingFailures.some((check) => check.id === 'real_codex_token_ledger_present'), true);
});

test('benchmark claim preflight blocks real Codex claim on deterministic product-diff mode', () => {
  const preflight = evaluateBenchmarkRunClaimPreflight({
    contract: {
      benchmarkId: 'mailchimp_real_claim_preflight',
      runId: 'run-001',
      metadata: { requestedClaim: 'real 100-agent Codex product work' },
      scope: { productDiffMode: 'semantic_product_architecture' }
    },
    env: {}
  });

  assert.equal(preflight.ok, false);
  assert.equal(preflight.status, 'blocked');
  assert.equal(preflight.requestedClaim, 'real_codex_product_work');
  assert.equal(preflight.blockingFailures.some((check) => check.id === 'real_codex_claim_uses_model_worker_mode'), true);
  assert.equal(preflight.blockingFailures.some((check) => check.id === 'real_codex_claim_has_worker_command'), true);
});

test('benchmark claim preflight infers real claim from suspicious 100real labels when explicit claim is missing', () => {
  const preflight = evaluateBenchmarkRunClaimPreflight({
    contract: {
      benchmarkId: 'mailchimp_100agent_product_parity_strict_validator_30m',
      runId: 'strict-100real-full-product-parity-30m-20260613T150057Z',
      scope: { productDiffMode: 'semantic_product_architecture' }
    },
    env: {}
  });

  assert.equal(preflight.ok, false);
  assert.equal(preflight.requestedClaim, 'real_codex_product_work');
  assert.equal(preflight.blockingFailures.some((check) => check.id === 'real_codex_claim_uses_model_worker_mode'), true);
});

test('benchmark claim preflight requires provider token ledger for real Codex claims', () => {
  const contract = {
    benchmarkId: 'mailchimp_real_codex_product_work',
    runId: 'real-codex-preflight-fixture',
    metadata: { requestedClaim: 'real_codex_product_work' },
    scope: {
      productDiffMode: 'creative_product_work',
      creativeProductWork: {
        required: true,
        workerCommand: 'node /home/jake/clawd-remote/large-project-capability-stack/apps/system-benchmark/codex-creative-worker.mjs'
      }
    }
  };

  const missingLedger = evaluateBenchmarkRunClaimPreflight({ contract, env: {} });
  assert.equal(missingLedger.ok, false);
  assert.equal(missingLedger.blockingFailures.some((check) => check.id === 'real_codex_claim_requires_token_ledger'), true);

  const ready = evaluateBenchmarkRunClaimPreflight({
    contract,
    env: { CREATIVE_WORKER_BUDGET_REQUIRED: 'true' }
  });
  assert.equal(ready.ok, true);
});

test('benchmark claim audit allows real Codex product claim when command, runtime, calls, and tokens are present', () => {
  const contract = {
    benchmarkId: 'mailchimp_real_codex_product_work',
    runId: 'real-codex-fixture',
    requestedAgentCount: 2,
    metadata: { requestedClaim: 'real_codex_product_work' },
    scope: { durationTargetMinutes: 30, productDiffMode: 'creative_product_work', creativeProductWork: { required: true } }
  };
  const resultRecords = ['surface_a', 'surface_b'].map((surfaceId, index) => ({
    ok: true,
    shardId: surfaceId,
    agentId: `agent-${index + 1}`,
    elapsedMs: 455_000,
    implementation: {
      ok: true,
      command: 'node /home/jake/clawd-remote/large-project-capability-stack/apps/system-benchmark/codex-creative-worker.mjs',
      durationMs: 420_000,
      firstMeaningfulProgressMs: 180_000,
      modifiedFiles: [`packages/app/${surfaceId}.mjs`],
      stdout: 'OpenAI Codex completed; tokens used 85000',
      metadata: {
        benchmarkMode: 'creative_product_work',
        productDiffMode: 'creative_product_work',
        creativeProductWorkRequired: true,
        creativeWorkerEvidence: { ok: true, iterationCount: 3, productModifiedFiles: [`packages/app/${surfaceId}.mjs`] }
      }
    },
    verifierResults: [{ ok: true, verifier: `${surfaceId}__tests`, durationMs: 1200 }]
  }));

  const audit = compileBenchmarkRunClaimIntegrityAudit({
    contract,
    resultRecords,
    thresholdPass: true,
    mechanicalGreen: true,
    scaleProofReady: true,
    tokenEvidence: { ledgerPresent: true, ledgerPath: '/tmp/creative-worker-budget-ledger.json', codexCallsStarted: 2, codexCallsCompleted: 2, tokensObserved: 170000 },
    durationEvidence: { durationTargetMinutes: 30 }
  });

  assert.equal(audit.requestedClaimAllowed, true);
  assert.equal(audit.highestHonestClaim, 'real_codex_product_work');
  assert.equal(audit.allowedClaims.includes('real_codex_product_work'), true);
  assert.equal(audit.observed.deterministicImplementationCount, 0);
  assert.equal(audit.tokenEvidence.tokensObserved, 170000);
});

test('benchmark claim audit honors 100-agent surface reliability floor without lowering Codex call scale', () => {
  const contract = {
    benchmarkId: 'maplestory3d_100agent_readiness',
    benchmarkTier: 'tier3_game_vertical_slice_100agent',
    runId: 'game-100agent-tolerant-fixture',
    requestedAgentCount: 100,
    metadata: { requestedClaim: 'real_codex_product_work' },
    scope: {
      durationTargetMinutes: 240,
      productDiffMode: 'creative_product_work',
      surfaceReliability: {
        enabled: true,
        greenMinVerifiedProductiveRatio: 0.95,
        maxToleratedFailedSurfaces: 5,
        requireClassifiedFailures: true
      },
      creativeProductWork: { required: true }
    }
  };
  const resultRecords = Array.from({ length: 95 }, (_, index) => ({
    ok: true,
    shardId: `surface_${index + 1}`,
    agentId: `agent-${index + 1}`,
    elapsedMs: 600_000,
    implementation: {
      ok: true,
      command: 'node /home/jake/clawd-remote/large-project-capability-stack/apps/system-benchmark/codex-creative-worker.mjs',
      durationMs: 300_000,
      firstMeaningfulProgressMs: 60_000,
      modifiedFiles: [`scripts/surface_${index + 1}.gd`],
      stdout: 'OpenAI Codex completed; tokens used 40000',
      metadata: {
        benchmarkMode: 'creative_product_work',
        productDiffMode: 'creative_product_work',
        creativeProductWorkRequired: true,
        creativeWorkerEvidence: { ok: true, iterationCount: 1, productModifiedFiles: [`scripts/surface_${index + 1}.gd`] }
      }
    },
    verifierResults: [{ ok: true, verifier: `surface_${index + 1}__godot`, durationMs: 1200 }]
  }));

  const audit = compileBenchmarkRunClaimIntegrityAudit({
    contract,
    resultRecords,
    thresholdPass: true,
    mechanicalGreen: true,
    scaleProofReady: true,
    tokenEvidence: { ledgerPresent: true, ledgerPath: '/tmp/creative-worker-budget-ledger.json', codexCallsStarted: 100, codexCallsCompleted: 100, tokensObserved: 4_000_000 },
    durationEvidence: { durationTargetMinutes: 240 }
  });

  assert.equal(audit.requestedClaimAllowed, true);
  const resultCountCheck = audit.checks.find((check) => check.id === 'real_codex_result_count_matches_requested_scale');
  assert.equal(resultCountCheck.ok, true);
  assert.equal(resultCountCheck.observed.requiredAcceptedResultCount, 95);
  const callCountCheck = audit.checks.find((check) => check.id === 'real_codex_calls_observed');
  assert.equal(callCountCheck.ok, true);
  assert.equal(callCountCheck.observed.requiredCodexCalls, 100);
});
