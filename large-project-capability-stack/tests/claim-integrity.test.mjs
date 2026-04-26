import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileClaimIntegrityReport,
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
