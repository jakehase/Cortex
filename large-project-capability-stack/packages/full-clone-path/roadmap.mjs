import { createClaimThresholdModel } from './thresholds.mjs';

function addMilestone(milestones, input) {
  milestones.push({
    id: input.id,
    title: input.title,
    lane: input.lane,
    dependsOn: input.dependsOn || [],
    goal: input.goal,
    targetDeltas: input.targetDeltas || {},
    acceptanceCriteria: input.acceptanceCriteria || [],
    blockingReasonsClosed: input.blockingReasonsClosed || []
  });
}

function buildGenericRoadmap({ gapReport, claim, targetClaim, targetLabel }) {
  const milestones = [];
  const missingRequiredFamilies = gapReport.surfaceFamilies?.missingRequired || [];
  const recommendedFamilies = gapReport.surfaceFamilies?.recommendedExpansion || [];
  const architectureDelta = {
    packageCount: gapReport.metricGaps.packageCount?.shortfallToMinimum || 0,
    moduleRoots: gapReport.metricGaps.moduleRoots?.shortfallToMinimum || 0,
    routeFiles: gapReport.metricGaps.routeFiles?.shortfallToMinimum || 0,
    domainFiles: gapReport.metricGaps.domainFiles?.shortfallToMinimum || 0,
    productFiles: gapReport.metricGaps.productFiles?.shortfallToMinimum || 0,
    productLines: gapReport.metricGaps.productLines?.shortfallToMinimum || 0
  };

  addMilestone(milestones, {
    id: 'M1.browser-proof-foundation',
    title: `Install real browser qualification and replace adapter-only evidence for ${targetLabel}`,
    lane: 'browser_realism',
    goal: 'Convert the current browser proof from adapter-only evidence into real automation evidence that can satisfy the requested claim.',
    targetDeltas: {
      realBrowser: gapReport.qualitativeGaps.realBrowser?.met ? 0 : 1,
      browserChecks: gapReport.metricGaps.browserChecks?.shortfallToMinimum || 0,
      realBrowserChecks: gapReport.metricGaps.realBrowserChecks?.shortfallToMinimum || 0,
      parityChecks: Math.max(0, gapReport.metricGaps.parityChecks?.shortfallToMinimum || 0)
    },
    acceptanceCriteria: [
      `realBrowser must become true (currently ${gapReport.currentEvidence.qualitative.realBrowser})`,
      `browserChecks >= ${claim.minimums.metrics.browserChecks}`,
      `realBrowserChecks >= ${claim.minimums.metrics.realBrowserChecks}`,
      'Mechanical downgrade reasons must no longer include no_real_browser_proof or simulated_browser_adapter'
    ],
    blockingReasonsClosed: ['realBrowser_not_met', 'browserChecks_below_minimum', 'realBrowserChecks_below_minimum']
  });

  addMilestone(milestones, {
    id: 'M2.architecture-breadth-expansion',
    title: `Expand repo/module/package breadth past the ${targetLabel} minimums`,
    lane: 'architecture_scale',
    dependsOn: ['M1.browser-proof-foundation'],
    goal: `Grow the repo from a compact scoped-parity slice into a multi-package architecture with enough module breadth to look like a ${targetLabel} candidate.`,
    targetDeltas: architectureDelta,
    acceptanceCriteria: [
      `packageCount >= ${claim.minimums.metrics.packageCount}`,
      `moduleRoots >= ${claim.minimums.metrics.moduleRoots}`,
      `routeFiles >= ${claim.minimums.metrics.routeFiles}`,
      `domainFiles >= ${claim.minimums.metrics.domainFiles}`,
      `productFiles >= ${claim.minimums.metrics.productFiles}`,
      `productLines >= ${claim.minimums.metrics.productLines}`
    ],
    blockingReasonsClosed: ['packageCount_below_minimum', 'moduleRoots_below_minimum', 'routeFiles_below_minimum', 'domainFiles_below_minimum', 'productFiles_below_minimum', 'productLines_below_minimum']
  });

  addMilestone(milestones, {
    id: 'M3.surface-family-expansion',
    title: `Add the missing product surface families that ${targetLabel} expects`,
    lane: 'product_surface',
    dependsOn: ['M2.architecture-breadth-expansion'],
    goal: 'Move beyond the current bounded slice by adding distinct family surfaces that materially widen product scope.',
    targetDeltas: {
      surfaceFamiliesComplete: gapReport.metricGaps.surfaceFamiliesComplete?.shortfallToMinimum || gapReport.surfaceFamilies?.shortfallToMinimumCount || 0,
      missingRequiredFamilies: missingRequiredFamilies.length,
      recommendedFamilies: recommendedFamilies.length > 0 ? 1 : 0
    },
    acceptanceCriteria: [
      `All required families for ${targetClaim} are complete: ${claim.minimums.surfaceFamilies.required.join(', ')}`,
      `surfaceFamiliesComplete >= ${claim.minimums.surfaceFamilies.minimumCompleteCount}`,
      missingRequiredFamilies.length > 0 ? `Currently missing required families: ${missingRequiredFamilies.join(', ')}` : 'No required families are currently missing'
    ],
    blockingReasonsClosed: missingRequiredFamilies.map((familyId) => `missing_surface_family:${familyId}`)
  });

  addMilestone(milestones, {
    id: 'M4.test-and-parity-depth',
    title: 'Raise test breadth, parity depth, and executable evidence density',
    lane: 'evidence_depth',
    dependsOn: ['M3.surface-family-expansion'],
    goal: 'Back the broader surface area with enough regression and parity evidence that the claim is not purely architectural inflation.',
    targetDeltas: {
      testFiles: gapReport.metricGaps.testFiles?.shortfallToMinimum || 0,
      testLines: gapReport.metricGaps.testLines?.shortfallToMinimum || 0,
      evidenceArtifacts: gapReport.metricGaps.evidenceArtifacts?.shortfallToMinimum || 0,
      artifactClasses: gapReport.metricGaps.artifactClasses?.shortfallToMinimum || 0,
      liveHttpChecks: gapReport.metricGaps.liveHttpChecks?.shortfallToMinimum || 0,
      parityChecks: gapReport.metricGaps.parityChecks?.shortfallToMinimum || 0
    },
    acceptanceCriteria: [
      `testFiles >= ${claim.minimums.metrics.testFiles}`,
      `testLines >= ${claim.minimums.metrics.testLines}`,
      `evidenceArtifacts >= ${claim.minimums.metrics.evidenceArtifacts}`,
      `artifactClasses >= ${claim.minimums.metrics.artifactClasses}`,
      `liveHttpChecks >= ${claim.minimums.metrics.liveHttpChecks}`,
      `parityChecks >= ${claim.minimums.metrics.parityChecks}`
    ],
    blockingReasonsClosed: ['testFiles_below_minimum', 'testLines_below_minimum', 'evidenceArtifacts_below_minimum', 'artifactClasses_below_minimum', 'liveHttpChecks_below_minimum', 'parityChecks_below_minimum']
  });

  addMilestone(milestones, {
    id: 'M5.requalify-full-clone-claim',
    title: `Re-run truth qualification and require ${targetLabel} to pass mechanically`,
    lane: 'qualification',
    dependsOn: ['M4.test-and-parity-depth'],
    goal: `Close the loop by forcing the certification ladder to admit ${targetClaim} and documenting any remaining buffer gaps.`,
    targetDeltas: { requestedClaimAllowed: gapReport.summary.eligibleForTargetClaim ? 0 : 1 },
    acceptanceCriteria: [
      `claim_certification.requestedClaimAllowed must become true for ${targetClaim}`,
      `claim_certification.highestAllowedClaim must become ${targetClaim}`,
      'Supervisor-owned surface matrix for the path compiler remains all_complete'
    ],
    blockingReasonsClosed: gapReport.summary.blockerReasons
  });

  return {
    lanes: [
      { id: 'browser_realism', title: 'Browser realism', focus: 'replace adapter-only evidence with real browser proof' },
      { id: 'architecture_scale', title: 'Architecture / scale', focus: 'grow files, lines, packages, roots, and route/domain breadth' },
      { id: 'product_surface', title: 'Product surface families', focus: 'add missing family-level capabilities instead of just inflating generic LOC' },
      { id: 'evidence_depth', title: 'Evidence depth', focus: 'tests, parity checks, and artifact density' },
      { id: 'qualification', title: 'Qualification', focus: 'force the stronger claim to pass under supervisor-owned truth gating' }
    ],
    milestones,
    backlogSummary: {
      milestoneCount: milestones.length,
      missingRequiredFamilies,
      recommendedFamilies,
      blockerReasons: gapReport.summary.blockerReasons
    }
  };
}

function buildRealWorldRoadmap({ gapReport, claim, targetClaim, targetLabel }) {
  const milestones = [];
  const missingRequiredFamilies = gapReport.surfaceFamilies?.missingRequired || [];
  const structural = gapReport.structuralGaps?.structuralCoverage || {};
  const browserCoverage = gapReport.structuralGaps?.browserCoverage || { coveredJourneyIds: [] };

  addMilestone(milestones, {
    id: 'M1.browser-automation-at-scale',
    title: `Establish real-browser proof across the full ${targetLabel} journey matrix`,
    lane: 'browser_realism',
    goal: 'Replace adapter-only browser evidence with large-scale real-browser automation spanning all top-tier journey families.',
    targetDeltas: {
      realBrowserChecks: gapReport.metricGaps.realBrowserChecks?.shortfallToMinimum || 0,
      browserChecks: gapReport.metricGaps.browserChecks?.shortfallToMinimum || 0,
      browserJourneyFamilies: gapReport.metricGaps.browserJourneyFamilies?.shortfallToMinimum || 0
    },
    acceptanceCriteria: [
      'realBrowser must be true and remain true in certification artifacts',
      `realBrowserChecks >= ${claim.minimums.metrics.realBrowserChecks}`,
      `browserJourneyFamilies >= ${claim.minimums.metrics.browserJourneyFamilies}`,
      `Current covered browser journey families: ${(browserCoverage.coveredJourneyIds || []).join(', ') || 'none'}`,
      'Browser suites must include authenticated workspace, audience/contact CRUD, campaign authoring/editor, automation, reporting, admin/governance, integrations, and public/signup flows'
    ],
    blockingReasonsClosed: ['realBrowser_not_met', 'browserChecks_below_minimum', 'realBrowserChecks_below_minimum', 'browserJourneyFamilies_below_minimum', 'browserRealismAtScale_not_met']
  });

  addMilestone(milestones, {
    id: 'M2.integration-realism',
    title: 'Add integration realism and partner/ecosystem execution depth',
    lane: 'integration_realism',
    dependsOn: ['M1.browser-automation-at-scale'],
    goal: 'Move beyond isolated app flows into multi-system realism: connectors, webhooks, marketplace flows, and live integration-grade checks.',
    targetDeltas: {
      integrationSurfaceFamilies: gapReport.metricGaps.integrationSurfaceFamilies?.shortfallToMinimum || 0,
      liveHttpChecks: gapReport.metricGaps.liveHttpChecks?.shortfallToMinimum || 0,
      parityChecks: gapReport.metricGaps.parityChecks?.shortfallToMinimum || 0
    },
    acceptanceCriteria: [
      `integrationSurfaceFamilies >= ${claim.minimums.metrics.integrationSurfaceFamilies}`,
      `liveHttpChecks >= ${claim.minimums.metrics.liveHttpChecks}`,
      `parityChecks >= ${claim.minimums.metrics.parityChecks}`,
      `Current ecosystem families complete: ${(structural.ecosystem?.completeIds || []).join(', ') || 'none'}`,
      'Qualification evidence must include marketplace/connector/webhook or equivalent ecosystem realism paths, not only core product flows'
    ],
    blockingReasonsClosed: ['integrationSurfaceFamilies_below_minimum', 'liveHttpChecks_below_minimum', 'parityChecks_below_minimum', 'integrationRealism_not_met']
  });

  addMilestone(milestones, {
    id: 'M3.enterprise-admin-compliance-breadth',
    title: 'Reach enterprise/admin/compliance breadth expected of a real operating product',
    lane: 'enterprise_governance',
    dependsOn: ['M1.browser-automation-at-scale'],
    goal: 'Close the governance gap with admin/API/ops, collaboration/approvals, deliverability/compliance, and related enterprise workflows.',
    targetDeltas: {
      enterpriseSurfaceFamilies: gapReport.metricGaps.enterpriseSurfaceFamilies?.shortfallToMinimum || 0,
      surfaceFamiliesComplete: gapReport.metricGaps.surfaceFamiliesComplete?.shortfallToMinimum || 0,
      artifactClasses: gapReport.metricGaps.artifactClasses?.shortfallToMinimum || 0
    },
    acceptanceCriteria: [
      `enterpriseSurfaceFamilies >= ${claim.minimums.metrics.enterpriseSurfaceFamilies}`,
      `surfaceFamiliesComplete >= ${claim.minimums.metrics.surfaceFamiliesComplete}`,
      `Current enterprise families complete: ${(structural.enterprise?.completeIds || []).join(', ') || 'none'}`,
      'Evidence must show enterprise/admin/compliance surfaces as real product families, not placeholders'
    ],
    blockingReasonsClosed: ['enterpriseSurfaceFamilies_below_minimum', 'surfaceFamiliesComplete_below_minimum', 'enterpriseReadiness_not_met']
  });

  addMilestone(milestones, {
    id: 'M4.architecture-growth',
    title: `Grow architecture/package/module breadth to the ${targetLabel} floor`,
    lane: 'architecture_scale',
    dependsOn: ['M2.integration-realism', 'M3.enterprise-admin-compliance-breadth'],
    goal: 'Scale the codebase into a genuinely massive multi-package system with broad route/domain decomposition and sustained operating breadth.',
    targetDeltas: {
      packageCount: gapReport.metricGaps.packageCount?.shortfallToMinimum || 0,
      appCount: gapReport.metricGaps.appCount?.shortfallToMinimum || 0,
      moduleRoots: gapReport.metricGaps.moduleRoots?.shortfallToMinimum || 0,
      routeFiles: gapReport.metricGaps.routeFiles?.shortfallToMinimum || 0,
      domainFiles: gapReport.metricGaps.domainFiles?.shortfallToMinimum || 0,
      productFiles: gapReport.metricGaps.productFiles?.shortfallToMinimum || 0,
      productLines: gapReport.metricGaps.productLines?.shortfallToMinimum || 0
    },
    acceptanceCriteria: [
      `packageCount >= ${claim.minimums.metrics.packageCount}`,
      `appCount >= ${claim.minimums.metrics.appCount}`,
      `moduleRoots >= ${claim.minimums.metrics.moduleRoots}`,
      `routeFiles >= ${claim.minimums.metrics.routeFiles}`,
      `domainFiles >= ${claim.minimums.metrics.domainFiles}`,
      `productFiles >= ${claim.minimums.metrics.productFiles}`,
      `productLines >= ${claim.minimums.metrics.productLines}`
    ],
    blockingReasonsClosed: ['packageCount_below_minimum', 'appCount_below_minimum', 'moduleRoots_below_minimum', 'routeFiles_below_minimum', 'domainFiles_below_minimum', 'productFiles_below_minimum', 'productLines_below_minimum']
  });

  addMilestone(milestones, {
    id: 'M5.scale-ops-and-evidence-realism',
    title: 'Back the scale claim with test depth, artifact realism, and operational evidence',
    lane: 'scale_ops_realism',
    dependsOn: ['M4.architecture-growth'],
    goal: 'Make the evidence trail look like a real-world operating product: large test suites, supervisor/report artifacts, and broad qualification telemetry.',
    targetDeltas: {
      testFiles: gapReport.metricGaps.testFiles?.shortfallToMinimum || 0,
      testLines: gapReport.metricGaps.testLines?.shortfallToMinimum || 0,
      evidenceArtifacts: gapReport.metricGaps.evidenceArtifacts?.shortfallToMinimum || 0,
      artifactClasses: gapReport.metricGaps.artifactClasses?.shortfallToMinimum || 0
    },
    acceptanceCriteria: [
      `testFiles >= ${claim.minimums.metrics.testFiles}`,
      `testLines >= ${claim.minimums.metrics.testLines}`,
      `evidenceArtifacts >= ${claim.minimums.metrics.evidenceArtifacts}`,
      `artifactClasses >= ${claim.minimums.metrics.artifactClasses}`,
      'Evidence realism, scale/ops realism, repo tests, target tests, supervisor, and notifier must all stay green'
    ],
    blockingReasonsClosed: ['testFiles_below_minimum', 'testLines_below_minimum', 'evidenceArtifacts_below_minimum', 'artifactClasses_below_minimum', 'evidenceRealism_not_met', 'scaleOpsRealism_not_met']
  });

  addMilestone(milestones, {
    id: 'M6.ecosystem-surface-depth',
    title: 'Finish ecosystem and revenue-adjacent surface depth',
    lane: 'ecosystem_depth',
    dependsOn: ['M2.integration-realism', 'M4.architecture-growth'],
    goal: 'Ensure the repo looks like a real product ecosystem with integrations, commerce/revenue, and supporting partner surfaces all represented materially.',
    targetDeltas: {
      integrationSurfaceFamilies: gapReport.metricGaps.integrationSurfaceFamilies?.shortfallToMinimum || 0,
      surfaceFamiliesComplete: gapReport.metricGaps.surfaceFamiliesComplete?.shortfallToMinimum || 0,
      domainFiles: Math.max(0, Math.round((gapReport.metricGaps.domainFiles?.shortfallToMinimum || 0) * 0.25))
    },
    acceptanceCriteria: [
      'Integrations / marketplace, commerce / revenue attribution, and deliverability / compliance families must be complete',
      'Revenue/ecosystem paths must be represented in routes, modules, and tests',
      'Surface-family coverage remains fully complete at the top tier'
    ],
    blockingReasonsClosed: ['missing_surface_family:integrations_marketplace', 'missing_surface_family:commerce_revenue', 'missing_surface_family:deliverability_compliance']
  });

  addMilestone(milestones, {
    id: 'M7.requalify-real-world-claim',
    title: `Re-run truth qualification and require ${targetLabel} to pass mechanically`,
    lane: 'qualification',
    dependsOn: ['M5.scale-ops-and-evidence-realism', 'M6.ecosystem-surface-depth'],
    goal: `Close the loop by forcing the certification ladder to admit ${targetClaim} and documenting any remaining operating-buffer gap.`,
    targetDeltas: { requestedClaimAllowed: gapReport.summary.eligibleForTargetClaim ? 0 : 1 },
    acceptanceCriteria: [
      `claim_certification.requestedClaimAllowed must become true for ${targetClaim}`,
      `claim_certification.highestAllowedClaim must become ${targetClaim}`,
      'Supervisor-owned surface matrix for the path compiler remains all_complete',
      'Final report must explicitly state whether real-world indistinguishability remains false or has been mechanically proven'
    ],
    blockingReasonsClosed: gapReport.summary.blockerReasons
  });

  return {
    lanes: [
      { id: 'browser_realism', title: 'Browser automation at scale', focus: 'real-browser coverage across all major journey families' },
      { id: 'integration_realism', title: 'Integration realism', focus: 'connector/webhook/ecosystem realism and broad parity depth' },
      { id: 'enterprise_governance', title: 'Enterprise / admin / compliance breadth', focus: 'admin/API/ops, governance, approvals, and compliance surfaces' },
      { id: 'architecture_scale', title: 'Architecture growth', focus: 'massive code/package/module/route/domain expansion' },
      { id: 'scale_ops_realism', title: 'Scale / ops realism', focus: 'tests, artifacts, supervisor signals, and evidence realism' },
      { id: 'ecosystem_depth', title: 'Ecosystem / integrations depth', focus: 'marketplace, revenue, partner, and adjacent product families' },
      { id: 'qualification', title: 'Qualification', focus: 'force the strongest claim to pass under supervisor-owned truth gating' }
    ],
    milestones,
    backlogSummary: {
      milestoneCount: milestones.length,
      missingRequiredFamilies,
      blockerReasons: gapReport.summary.blockerReasons,
      structuralBlockers: gapReport.summary.strongestStructuralBlockers
    }
  };
}

export function compileUpgradeRoadmap({ gapReport, thresholdModel, targetClaim = 'full_clone_credible' } = {}) {
  const model = thresholdModel || createClaimThresholdModel();
  const claim = model.claimLevels[targetClaim];
  if (!claim) throw new Error(`Unknown target claim ${targetClaim}`);
  const targetLabel = targetClaim.replaceAll('_', ' ');

  const roadmap = targetClaim === 'real_world_indistinguishable'
    ? buildRealWorldRoadmap({ gapReport, claim, targetClaim, targetLabel })
    : buildGenericRoadmap({ gapReport, claim, targetClaim, targetLabel });

  return {
    generatedAt: new Date().toISOString(),
    repoRoot: gapReport.repoRoot,
    currentClaim: gapReport.currentClaim,
    targetClaim,
    readiness: gapReport.summary.posture,
    ...roadmap
  };
}
