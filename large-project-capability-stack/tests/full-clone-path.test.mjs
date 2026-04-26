import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createClaimThresholdModel,
  collectRepoPathEvidence,
  analyzeThresholdGaps,
  compileUpgradeRoadmap,
  estimateCostTrajectory
} from '../packages/full-clone-path/index.mjs';
import { createBrowserParityFromProof, selectPreferredBrowserParity } from '../packages/certification/index.mjs';

function writeLines(filePath, count, line = 'export const value = 1;') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Array.from({ length: count }, () => line).join('\n'));
}

function buildScopedParityFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'full-clone-path-'));
  for (const folder of ['apps/web', 'packages/app/routes', 'packages/campaign', 'tests', 'docs', 'artifacts']) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
  }

  const productFiles = [
    'apps/web/server.mjs',
    'packages/app/index.mjs',
    'packages/app/domain-core.mjs',
    'packages/app/domain-audience.mjs',
    'packages/app/domain-campaigns.mjs',
    'packages/app/domain-growth.mjs',
    'packages/app/storage.mjs',
    'packages/app/jobs.mjs',
    'packages/app/router.mjs',
    'packages/app/routes/platform.mjs',
    'packages/app/routes/public.mjs',
    'packages/app/routes/audience.mjs',
    'packages/app/routes/campaigns.mjs',
    'packages/app/routes/automations.mjs',
    'packages/app/routes/forms.mjs',
    'packages/app/routes/reports.mjs',
    'packages/app/routes/api-admin.mjs',
    'packages/campaign/index.mjs'
  ];
  for (const file of productFiles) writeLines(path.join(dir, file), 110);

  const testFiles = [
    'tests/platform-spine.test.mjs',
    'tests/audience-core.test.mjs',
    'tests/campaign-pipeline.test.mjs',
    'tests/automation-journeys.test.mjs',
    'tests/forms-landing.test.mjs',
    'tests/reports-admin.test.mjs'
  ];
  for (const file of testFiles) writeLines(path.join(dir, file), 80, 'export const ok = true;');

  return dir;
}

function namedEvidenceArtifacts(repoRoot) {
  return [
    path.join(repoRoot, 'artifacts', 'architecture.json'),
    path.join(repoRoot, 'artifacts', 'parity.json'),
    path.join(repoRoot, 'artifacts', 'claim_certification.json'),
    path.join(repoRoot, 'artifacts', 'recovery.json'),
    path.join(repoRoot, 'artifacts', 'program_state.json'),
    path.join(repoRoot, 'artifacts', 'surface_matrix.json'),
    path.join(repoRoot, 'reports', 'qualification_summary.json'),
    path.join(repoRoot, 'validation', 'repo_tests.log'),
    path.join(repoRoot, 'validation', 'mailchimp_tests.log'),
    path.join(repoRoot, 'validation', 'mailchimp_supervisor.log'),
    path.join(repoRoot, 'validation', 'mailchimp_notify.log')
  ];
}

function scopedParityEvidence(repoRoot, requestedClaim = 'real_world_indistinguishable') {
  return collectRepoPathEvidence({
    repoRoot,
    certification: {
      requestedClaim,
      highestAllowedClaim: 'scoped_parity',
      requestedClaimAllowed: false,
      publicSummary: { downgradeReasons: [`${requestedClaim}_not_established`] }
    },
    parityReport: {
      ok: true,
      liveHttp: {
        ok: true,
        passed: 4,
        checks: [
          { id: 'http.signup.dashboard', ok: true },
          { id: 'http.audience.filter', ok: true },
          { id: 'http.campaign.editor', ok: true },
          { id: 'http.status', ok: true }
        ],
        evidence: {
          browser: { available: false, real: false, driver: 'none' }
        }
      },
      browserAdapter: {
        ok: true,
        passed: 2,
        checks: [
          { id: 'browser.dashboard', ok: true },
          { id: 'browser.campaigns', ok: true }
        ],
        evidence: {
          browser: { available: true, real: false, driver: 'simulated-browser' }
        }
      }
    },
    evidenceArtifacts: namedEvidenceArtifacts(repoRoot),
    repoTestsOk: true,
    targetTestsOk: true,
    supervisorOk: true,
    notifyOk: true
  });
}

test('claim threshold model exposes materially stronger real-world-indistinguishable targets', () => {
  const model = createClaimThresholdModel();
  assert.equal(model.version >= 2, true);
  assert.equal(model.claimLevels.large_product_replica.minimums.metrics.productLines, 750000);
  assert.equal(model.claimLevels.real_world_indistinguishable.minimums.metrics.productLines, 1500000);
  assert.ok(model.claimLevels.real_world_indistinguishable.minimums.metrics.realBrowserChecks > model.claimLevels.large_product_replica.minimums.metrics.realBrowserChecks);
  assert.ok(model.claimLevels.real_world_indistinguishable.minimums.metrics.browserJourneyFamilies > model.claimLevels.large_product_replica.minimums.metrics.browserJourneyFamilies);
  assert.ok(model.claimLevels.real_world_indistinguishable.minimums.metrics.artifactClasses > model.claimLevels.large_product_replica.minimums.metrics.artifactClasses);
  assert.ok(model.claimLevels.real_world_indistinguishable.minimums.qualitative.browserRealismAtScale);
  assert.ok(model.claimLevels.real_world_indistinguishable.minimums.qualitative.integrationRealism);
  assert.ok(model.claimLevels.real_world_indistinguishable.minimums.surfaceFamilies.required.includes('deliverability_compliance'));
});

test('path evidence prefers real browser proof over simulated adapter evidence when both exist', () => {
  const repoRoot = buildScopedParityFixture();
  const realBrowserProof = createBrowserParityFromProof({
    generatedAt: new Date().toISOString(),
    realBrowser: true,
    ok: true,
    driver: 'playwright-chromium',
    browserChecks: 24,
    realBrowserChecks: 24,
    coveredFamilies: ['campaign_editor', 'public_signup_flows', 'reports_analytics', 'admin_permissions'],
    scenarios: [
      { id: 'campaign_editor', checks: [{ id: 'editor_opened', detail: 'opened editor' }] },
      { id: 'public_signup_flows', checks: [{ id: 'signup_submitted', detail: 'submitted form' }] },
      { id: 'reports_analytics', checks: [{ id: 'report_loaded', detail: 'loaded report' }] },
      { id: 'admin_permissions', checks: [{ id: 'team_updated', detail: 'updated team' }] }
    ]
  }, { sourcePath: path.join(repoRoot, 'artifacts', 'browser_proof.json') });

  const evidence = collectRepoPathEvidence({
    repoRoot,
    certification: {
      requestedClaim: 'real_world_indistinguishable',
      highestAllowedClaim: 'scoped_parity',
      requestedClaimAllowed: false,
      publicSummary: { downgradeReasons: ['real_world_indistinguishable_not_established'] }
    },
    parityReport: {
      ok: true,
      liveHttp: {
        ok: true,
        passed: 4,
        checks: [{ id: 'http.status', ok: true }],
        evidence: { browser: { available: false, real: false, driver: 'none' } }
      },
      browser: realBrowserProof,
      browserAdapter: {
        ok: true,
        passed: 2,
        checks: [{ id: 'browser.dashboard', ok: true }],
        evidence: { browser: { available: true, real: false, driver: 'simulated-browser' } }
      }
    },
    evidenceArtifacts: namedEvidenceArtifacts(repoRoot),
    repoTestsOk: true,
    targetTestsOk: true,
    supervisorOk: true,
    notifyOk: true
  });

  assert.equal(selectPreferredBrowserParity({ browser: realBrowserProof, browserAdapter: { ok: true, evidence: { browser: { real: false } } } }).evidence.browser.real, true);
  assert.equal(evidence.qualitative.realBrowser, true);
  assert.equal(evidence.census.realBrowserChecks, 24);
  assert.ok(evidence.census.browserJourneyFamilies >= 4);
});

test('gap analysis reports that scoped parity is extremely far from real-world indistinguishability', () => {
  const repoRoot = buildScopedParityFixture();
  const evidence = scopedParityEvidence(repoRoot, 'real_world_indistinguishable');
  const gap = analyzeThresholdGaps({ thresholdModel: createClaimThresholdModel(), evidence, targetClaim: 'real_world_indistinguishable' });

  assert.equal(gap.currentClaim, 'scoped_parity');
  assert.equal(gap.summary.eligibleForTargetClaim, false);
  assert.ok(gap.summary.blockerReasons.includes('productLines_below_minimum'));
  assert.ok(gap.summary.blockerReasons.includes('realBrowserChecks_below_minimum'));
  assert.ok(gap.summary.blockerReasons.includes('browserJourneyFamilies_below_minimum'));
  assert.ok(gap.summary.blockerReasons.includes('integrationRealism_not_met'));
  assert.ok(gap.summary.blockerReasons.includes('enterpriseReadiness_not_met'));
  assert.ok(gap.surfaceFamilies.missingRequired.includes('content_asset_templates'));
  assert.ok(gap.structuralGaps.areas.find((area) => area.id === 'browser_realism').unmetMetrics.length >= 2);
  assert.ok(gap.summary.weightedCoverage < 0.35);
});

test('gap analysis still supports large-product-replica targeting as an intermediate tier', () => {
  const repoRoot = buildScopedParityFixture();
  const evidence = scopedParityEvidence(repoRoot, 'large_product_replica');
  const gap = analyzeThresholdGaps({ thresholdModel: createClaimThresholdModel(), evidence, targetClaim: 'large_product_replica' });

  assert.equal(gap.currentClaim, 'scoped_parity');
  assert.equal(gap.summary.eligibleForTargetClaim, false);
  assert.equal(gap.metricGaps.productLines.minimumRequired, 750000);
  assert.ok(gap.metricGaps.productLines.shortfallToMinimum > 700000);
  assert.ok(gap.metricGaps.realBrowserChecks.shortfallToMinimum >= 20);
});

test('roadmap compiler emits explicit top-tier workstreams for real-world indistinguishability', () => {
  const repoRoot = buildScopedParityFixture();
  const model = createClaimThresholdModel();
  const evidence = scopedParityEvidence(repoRoot, 'real_world_indistinguishable');
  const gap = analyzeThresholdGaps({ thresholdModel: model, evidence, targetClaim: 'real_world_indistinguishable' });
  const roadmap = compileUpgradeRoadmap({ gapReport: gap, thresholdModel: model, targetClaim: 'real_world_indistinguishable' });

  assert.equal(roadmap.targetClaim, 'real_world_indistinguishable');
  assert.equal(roadmap.milestones.length, 7);
  assert.ok(roadmap.lanes.some((lane) => lane.id === 'browser_realism'));
  assert.ok(roadmap.lanes.some((lane) => lane.id === 'integration_realism'));
  assert.ok(roadmap.lanes.some((lane) => lane.id === 'enterprise_governance'));
  assert.ok(roadmap.lanes.some((lane) => lane.id === 'ecosystem_depth'));
  assert.ok(roadmap.lanes.some((lane) => lane.id === 'scale_ops_realism'));
  assert.equal(roadmap.milestones[1].dependsOn[0], 'M1.browser-automation-at-scale');
  assert.ok(roadmap.backlogSummary.blockerReasons.includes('productLines_below_minimum'));
});

test('trajectory estimator emits multi-wave expansion estimates for real-world indistinguishability', () => {
  const repoRoot = buildScopedParityFixture();
  const model = createClaimThresholdModel();
  const evidence = scopedParityEvidence(repoRoot, 'real_world_indistinguishable');
  const gap = analyzeThresholdGaps({ thresholdModel: model, evidence, targetClaim: 'real_world_indistinguishable' });
  const roadmap = compileUpgradeRoadmap({ gapReport: gap, thresholdModel: model, targetClaim: 'real_world_indistinguishable' });
  const trajectory = estimateCostTrajectory({ gapReport: gap, roadmap, thresholdModel: model, targetClaim: 'real_world_indistinguishable' });

  assert.equal(trajectory.waves.length, 5);
  assert.equal(trajectory.posture.conclusion, 'real_world_indistinguishable_requires_multi_program_expansion');
  assert.ok(trajectory.estimates.estimatedProductLinesNeeded >= 1400000);
  assert.ok(trajectory.estimates.estimatedBrowserJourneyFamiliesToCover >= 8);
  assert.ok(trajectory.estimates.estimatedArtifactClassesToAdd > 0);
});
