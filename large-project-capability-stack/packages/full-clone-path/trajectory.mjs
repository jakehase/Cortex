import { createClaimThresholdModel } from './thresholds.mjs';

function baseDeltas(gapReport) {
  return Object.fromEntries(Object.entries(gapReport.metricGaps).map(([key, value]) => [key, value.shortfallToMinimum]));
}

function targetDeltas(gapReport) {
  return Object.fromEntries(Object.entries(gapReport.metricGaps).map(([key, value]) => [key, value.shortfallToTarget]));
}

function buildGenericTrajectory({ gapReport, roadmap, claim }) {
  const heuristics = {
    linesPerNewRouteOrDomainModule: 260,
    linesPerNewPackageBootstrap: 180,
    linesPerNewTestFile: 140,
    browserJourneyImplementationLines: 120,
    familyExpansionProductLineFloor: 900,
    familyExpansionTestLineFloor: 160
  };

  const minimumDelta = baseDeltas(gapReport);
  const targetDelta = targetDeltas(gapReport);
  const missingRequiredFamilies = gapReport.surfaceFamilies?.missingRequired || [];
  const recommendedFamilies = gapReport.surfaceFamilies?.recommendedExpansion || [];
  const familyExpansionCount = missingRequiredFamilies.length + Math.min(1, recommendedFamilies.length);

  const architectureLinesEstimate =
    ((minimumDelta.routeFiles || 0) + (minimumDelta.domainFiles || 0)) * heuristics.linesPerNewRouteOrDomainModule
    + (minimumDelta.packageCount || 0) * heuristics.linesPerNewPackageBootstrap;
  const familyLinesEstimate = familyExpansionCount * heuristics.familyExpansionProductLineFloor;
  const browserLinesEstimate = Math.max(1, minimumDelta.browserChecks || 0) * heuristics.browserJourneyImplementationLines;
  const estimatedProductLinesNeeded = Math.max(minimumDelta.productLines || 0, architectureLinesEstimate + familyLinesEstimate + browserLinesEstimate);
  const estimatedTestLinesNeeded = Math.max(
    minimumDelta.testLines || 0,
    ((minimumDelta.testFiles || 0) * heuristics.linesPerNewTestFile) + (familyExpansionCount * heuristics.familyExpansionTestLineFloor)
  );

  const waves = [
    {
      id: 'wave_1_browser_and_architecture_foundation',
      dependsOn: [],
      closesMilestones: roadmap.milestones.filter((milestone) => ['M1.browser-proof-foundation', 'M2.architecture-breadth-expansion'].includes(milestone.id)).map((milestone) => milestone.id),
      estimatedAdds: {
        packageCount: Math.min(1, minimumDelta.packageCount || 0),
        moduleRoots: Math.min(1, minimumDelta.moduleRoots || 0),
        routeFiles: Math.min(1, minimumDelta.routeFiles || 0),
        domainFiles: Math.min(1, minimumDelta.domainFiles || 0),
        browserChecks: Math.max(2, Math.min(3, claim.minimums.metrics.browserChecks)),
        productLines: Math.max(2200, Math.round(estimatedProductLinesNeeded * 0.25)),
        testFiles: Math.max(1, Math.min(2, (minimumDelta.testFiles || 0) + 1)),
        testLines: Math.max(220, Math.round(estimatedTestLinesNeeded * 0.2))
      }
    },
    {
      id: 'wave_2_surface_family_expansion',
      dependsOn: ['wave_1_browser_and_architecture_foundation'],
      closesMilestones: roadmap.milestones.filter((milestone) => milestone.id === 'M3.surface-family-expansion').map((milestone) => milestone.id),
      estimatedAdds: {
        surfaceFamiliesComplete: Math.max(1, missingRequiredFamilies.length),
        routeFiles: Math.max(1, (minimumDelta.routeFiles || 0) - 1),
        domainFiles: Math.max(1, minimumDelta.domainFiles || 0),
        packageCount: Math.max(1, (minimumDelta.packageCount || 0) - 1),
        moduleRoots: Math.max(1, (minimumDelta.moduleRoots || 0) - 1),
        productLines: Math.max(4200, Math.round(estimatedProductLinesNeeded * 0.45)),
        testFiles: Math.max(1, Math.round((minimumDelta.testFiles || 0) / 2) || 1),
        testLines: Math.max(320, Math.round(estimatedTestLinesNeeded * 0.45))
      },
      targetFamilies: [...missingRequiredFamilies, ...recommendedFamilies.slice(0, 1)]
    },
    {
      id: 'wave_3_depth_and_requalification',
      dependsOn: ['wave_2_surface_family_expansion'],
      closesMilestones: roadmap.milestones.filter((milestone) => ['M4.test-and-parity-depth', 'M5.requalify-full-clone-claim'].includes(milestone.id)).map((milestone) => milestone.id),
      estimatedAdds: {
        parityChecks: Math.max(0, minimumDelta.parityChecks || 0),
        liveHttpChecks: Math.max(0, minimumDelta.liveHttpChecks || 0),
        browserChecks: Math.max(0, (minimumDelta.browserChecks || 0) - 2),
        evidenceArtifacts: Math.max(0, minimumDelta.evidenceArtifacts || 0),
        productLines: Math.max(2500, Math.round(estimatedProductLinesNeeded * 0.3)),
        testFiles: Math.max(1, (minimumDelta.testFiles || 0) - 1),
        testLines: Math.max(260, Math.round(estimatedTestLinesNeeded * 0.35))
      }
    }
  ];

  return {
    heuristics,
    minimumDelta,
    operationalTargetDelta: targetDelta,
    estimates: {
      estimatedProductLinesNeeded,
      estimatedTestLinesNeeded,
      estimatedNewPackages: minimumDelta.packageCount || 0,
      estimatedNewModuleRoots: minimumDelta.moduleRoots || 0,
      estimatedNewFamiliesToAdd: familyExpansionCount,
      estimatedRealBrowserWorkstreams: gapReport.qualitativeGaps.realBrowser?.met ? 0 : 1
    },
    waves,
    posture: {
      currentClaim: gapReport.currentClaim,
      minimumTargetStillUnmet: gapReport.summary.blockerReasons.length,
      conclusion: gapReport.summary.blockerReasons.length === 0 ? 'already_at_threshold' : 'material_multi_wave_expansion_required'
    }
  };
}

function buildRealWorldTrajectory({ gapReport, roadmap }) {
  const heuristics = {
    linesPerNewRouteOrDomainModule: 420,
    linesPerNewPackageBootstrap: 320,
    linesPerNewTestFile: 220,
    linesPerBrowserJourneyFamily: 1400,
    linesPerIntegrationFamily: 2200,
    linesPerEnterpriseFamily: 1800,
    linesPerArtifactClass: 350,
    linesPerAppShell: 2600
  };

  const minimumDelta = baseDeltas(gapReport);
  const targetDelta = targetDeltas(gapReport);
  const missingRequiredFamilies = gapReport.surfaceFamilies?.missingRequired || [];
  const structural = gapReport.structuralGaps?.structuralCoverage || {};
  const browserFamilyDelta = minimumDelta.browserJourneyFamilies || 0;
  const integrationFamilyDelta = minimumDelta.integrationSurfaceFamilies || 0;
  const enterpriseFamilyDelta = minimumDelta.enterpriseSurfaceFamilies || 0;

  const architectureLinesEstimate =
    ((minimumDelta.routeFiles || 0) + (minimumDelta.domainFiles || 0)) * heuristics.linesPerNewRouteOrDomainModule
    + (minimumDelta.packageCount || 0) * heuristics.linesPerNewPackageBootstrap
    + (minimumDelta.appCount || 0) * heuristics.linesPerAppShell;
  const browserLinesEstimate = Math.max(1, browserFamilyDelta) * heuristics.linesPerBrowserJourneyFamily;
  const integrationLinesEstimate = Math.max(1, integrationFamilyDelta) * heuristics.linesPerIntegrationFamily;
  const enterpriseLinesEstimate = Math.max(1, enterpriseFamilyDelta) * heuristics.linesPerEnterpriseFamily;
  const artifactLinesEstimate = Math.max(1, minimumDelta.artifactClasses || 0) * heuristics.linesPerArtifactClass;

  const estimatedProductLinesNeeded = Math.max(
    minimumDelta.productLines || 0,
    architectureLinesEstimate + browserLinesEstimate + integrationLinesEstimate + enterpriseLinesEstimate + artifactLinesEstimate
  );
  const estimatedTestLinesNeeded = Math.max(
    minimumDelta.testLines || 0,
    ((minimumDelta.testFiles || 0) * heuristics.linesPerNewTestFile)
      + (browserFamilyDelta * 260)
      + (integrationFamilyDelta * 400)
      + (enterpriseFamilyDelta * 320)
  );

  const waves = [
    {
      id: 'wave_1_browser_realism_foundation',
      dependsOn: [],
      closesMilestones: roadmap.milestones.filter((milestone) => milestone.id === 'M1.browser-automation-at-scale').map((milestone) => milestone.id),
      estimatedAdds: {
        realBrowserChecks: Math.max(12, Math.round((minimumDelta.realBrowserChecks || 0) * 0.25)),
        browserChecks: Math.max(16, Math.round((minimumDelta.browserChecks || 0) * 0.25)),
        browserJourneyFamilies: Math.max(3, Math.min(4, browserFamilyDelta || 3)),
        productLines: Math.max(16000, Math.round(estimatedProductLinesNeeded * 0.16)),
        testFiles: Math.max(8, Math.round((minimumDelta.testFiles || 0) * 0.15)),
        testLines: Math.max(2400, Math.round(estimatedTestLinesNeeded * 0.18))
      }
    },
    {
      id: 'wave_2_integration_and_enterprise_breadth',
      dependsOn: ['wave_1_browser_realism_foundation'],
      closesMilestones: roadmap.milestones.filter((milestone) => ['M2.integration-realism', 'M3.enterprise-admin-compliance-breadth'].includes(milestone.id)).map((milestone) => milestone.id),
      estimatedAdds: {
        integrationSurfaceFamilies: Math.max(1, integrationFamilyDelta),
        enterpriseSurfaceFamilies: Math.max(1, enterpriseFamilyDelta),
        liveHttpChecks: Math.max(8, Math.round((minimumDelta.liveHttpChecks || 0) * 0.35)),
        parityChecks: Math.max(14, Math.round((minimumDelta.parityChecks || 0) * 0.3)),
        surfaceFamiliesComplete: Math.max(2, missingRequiredFamilies.length),
        productLines: Math.max(42000, Math.round(estimatedProductLinesNeeded * 0.24)),
        testLines: Math.max(5400, Math.round(estimatedTestLinesNeeded * 0.24))
      },
      targetFamilies: [
        ...(structural.ecosystem?.missingIds || []),
        ...(structural.enterprise?.missingIds || [])
      ]
    },
    {
      id: 'wave_3_architecture_mass_and_ops',
      dependsOn: ['wave_2_integration_and_enterprise_breadth'],
      closesMilestones: roadmap.milestones.filter((milestone) => milestone.id === 'M4.architecture-growth').map((milestone) => milestone.id),
      estimatedAdds: {
        packageCount: Math.max(8, Math.round((minimumDelta.packageCount || 0) * 0.45)),
        appCount: Math.max(1, Math.round((minimumDelta.appCount || 0) * 0.5)),
        moduleRoots: Math.max(10, Math.round((minimumDelta.moduleRoots || 0) * 0.45)),
        routeFiles: Math.max(20, Math.round((minimumDelta.routeFiles || 0) * 0.4)),
        domainFiles: Math.max(14, Math.round((minimumDelta.domainFiles || 0) * 0.4)),
        productFiles: Math.max(90, Math.round((minimumDelta.productFiles || 0) * 0.4)),
        productLines: Math.max(520000, Math.round(estimatedProductLinesNeeded * 0.34))
      }
    },
    {
      id: 'wave_4_evidence_realism_and_regression_depth',
      dependsOn: ['wave_3_architecture_mass_and_ops'],
      closesMilestones: roadmap.milestones.filter((milestone) => ['M5.scale-ops-and-evidence-realism', 'M6.ecosystem-surface-depth'].includes(milestone.id)).map((milestone) => milestone.id),
      estimatedAdds: {
        testFiles: Math.max(24, Math.round((minimumDelta.testFiles || 0) * 0.45)),
        testLines: Math.max(64000, Math.round(estimatedTestLinesNeeded * 0.38)),
        evidenceArtifacts: Math.max(16, Math.round((minimumDelta.evidenceArtifacts || 0) * 0.45)),
        artifactClasses: Math.max(3, minimumDelta.artifactClasses || 0),
        parityChecks: Math.max(22, Math.round((minimumDelta.parityChecks || 0) * 0.4)),
        liveHttpChecks: Math.max(10, Math.round((minimumDelta.liveHttpChecks || 0) * 0.35))
      }
    },
    {
      id: 'wave_5_final_requalification',
      dependsOn: ['wave_4_evidence_realism_and_regression_depth'],
      closesMilestones: roadmap.milestones.filter((milestone) => milestone.id === 'M7.requalify-real-world-claim').map((milestone) => milestone.id),
      estimatedAdds: {
        realBrowserChecks: Math.max(0, (minimumDelta.realBrowserChecks || 0) - Math.round((minimumDelta.realBrowserChecks || 0) * 0.25)),
        browserChecks: Math.max(0, (minimumDelta.browserChecks || 0) - Math.round((minimumDelta.browserChecks || 0) * 0.25)),
        productLines: Math.max(180000, Math.round(estimatedProductLinesNeeded * 0.12)),
        testLines: Math.max(32000, Math.round(estimatedTestLinesNeeded * 0.2)),
        evidenceArtifacts: Math.max(4, Math.round((minimumDelta.evidenceArtifacts || 0) * 0.15))
      }
    }
  ];

  return {
    heuristics,
    minimumDelta,
    operationalTargetDelta: targetDelta,
    estimates: {
      estimatedProductLinesNeeded,
      estimatedTestLinesNeeded,
      estimatedNewPackages: minimumDelta.packageCount || 0,
      estimatedNewModuleRoots: minimumDelta.moduleRoots || 0,
      estimatedNewApps: minimumDelta.appCount || 0,
      estimatedNewFamiliesToAdd: missingRequiredFamilies.length,
      estimatedBrowserJourneyFamiliesToCover: browserFamilyDelta,
      estimatedIntegrationFamiliesToAdd: integrationFamilyDelta,
      estimatedEnterpriseFamiliesToAdd: enterpriseFamilyDelta,
      estimatedArtifactClassesToAdd: minimumDelta.artifactClasses || 0,
      estimatedRealBrowserWorkstreams: gapReport.qualitativeGaps.realBrowser?.met ? 0 : 1
    },
    waves,
    posture: {
      currentClaim: gapReport.currentClaim,
      minimumTargetStillUnmet: gapReport.summary.blockerReasons.length,
      conclusion: gapReport.summary.blockerReasons.length === 0 ? 'already_at_threshold' : 'real_world_indistinguishable_requires_multi_program_expansion'
    }
  };
}

export function estimateCostTrajectory({ gapReport, roadmap, thresholdModel, targetClaim = 'full_clone_credible' } = {}) {
  const model = thresholdModel || createClaimThresholdModel();
  const claim = model.claimLevels[targetClaim];
  if (!claim) throw new Error(`Unknown target claim ${targetClaim}`);

  const trajectory = targetClaim === 'real_world_indistinguishable'
    ? buildRealWorldTrajectory({ gapReport, roadmap, claim })
    : buildGenericTrajectory({ gapReport, roadmap, claim });

  return {
    generatedAt: new Date().toISOString(),
    repoRoot: gapReport.repoRoot,
    targetClaim,
    current: gapReport.currentEvidence.census,
    minimumTarget: claim.minimums.metrics,
    operationalTarget: claim.operationalTarget.metrics,
    ...trajectory
  };
}
