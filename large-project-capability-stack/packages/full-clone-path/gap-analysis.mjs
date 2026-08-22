import { createClaimThresholdModel } from './thresholds.mjs';

function metricGap(current, threshold, target = threshold) {
  const currentValue = Number(current || 0);
  const minimumValue = Number(threshold || 0);
  const targetValue = Number(target || minimumValue);
  return {
    current: currentValue,
    minimumRequired: minimumValue,
    operationalTarget: targetValue,
    shortfallToMinimum: Math.max(0, minimumValue - currentValue),
    shortfallToTarget: Math.max(0, targetValue - currentValue),
    metMinimum: currentValue >= minimumValue,
    metOperationalTarget: currentValue >= targetValue,
    percentOfMinimum: minimumValue === 0 ? 1 : Number((currentValue / minimumValue).toFixed(3)),
    percentOfOperationalTarget: targetValue === 0 ? 1 : Number((currentValue / targetValue).toFixed(3))
  };
}

function scoreGap(current, threshold) {
  const currentValue = Number(current || 0);
  const minimumValue = Number(threshold || 0);
  return {
    current: currentValue,
    minimumRequired: minimumValue,
    shortfall: Math.max(0, minimumValue - currentValue),
    met: currentValue >= minimumValue
  };
}

function severityFromRatio(ratio) {
  if (ratio >= 1) return 'met';
  if (ratio >= 0.75) return 'buffer_gap';
  if (ratio >= 0.4) return 'material_gap';
  return 'extreme_gap';
}

function structuralArea({ id, label, metrics }) {
  const entries = Object.entries(metrics).map(([metricId, gap]) => ({ id: metricId, ...gap, severity: severityFromRatio(gap.percentOfMinimum) }));
  return {
    id,
    label,
    metrics: entries,
    unmetMetrics: entries.filter((entry) => !entry.metMinimum),
    met: entries.every((entry) => entry.metMinimum)
  };
}

export function analyzeThresholdGaps({ thresholdModel, evidence, targetClaim = 'full_clone_credible' } = {}) {
  const model = thresholdModel || createClaimThresholdModel();
  const claim = model.claimLevels[targetClaim];
  if (!claim) throw new Error(`Unknown target claim ${targetClaim}`);

  const metricGaps = Object.fromEntries(Object.entries(claim.minimums.metrics).map(([key, minimumValue]) => {
    const operationalTarget = claim.operationalTarget?.metrics?.[key] ?? minimumValue;
    return [key, metricGap(evidence.census?.[key], minimumValue, operationalTarget)];
  }));

  const scoreGaps = Object.fromEntries(Object.entries(claim.minimums.scores).map(([key, minimumValue]) => {
    const current = evidence.baseEvidence?.dimensionScores?.[key] ?? evidence.architecture?.budget?.shapeScores?.[key] ?? 0;
    return [key, scoreGap(current, minimumValue)];
  }));

  const qualitativeGaps = Object.fromEntries(Object.entries(claim.minimums.qualitative).map(([key, expected]) => {
    const current = Boolean(evidence.qualitative?.[key]);
    return [key, { current, expected: Boolean(expected), met: Boolean(expected) === current, shortfall: Boolean(expected) && !current ? 1 : 0 }];
  }));

  const requiredFamilies = claim.minimums.surfaceFamilies?.required || [];
  const completeFamilies = new Set(evidence.coverageSummary?.completeIds || []);
  const missingRequired = requiredFamilies.filter((familyId) => !completeFamilies.has(familyId));
  const recommendedExpansion = (claim.minimums.surfaceFamilies?.recommendedExpansion || []).filter((familyId) => !completeFamilies.has(familyId));
  const surfaceFamilies = {
    minimumCompleteCount: claim.minimums.surfaceFamilies?.minimumCompleteCount || requiredFamilies.length,
    currentCompleteCount: evidence.coverageSummary?.complete || 0,
    shortfallToMinimumCount: Math.max(0, (claim.minimums.surfaceFamilies?.minimumCompleteCount || 0) - (evidence.coverageSummary?.complete || 0)),
    missingRequired,
    recommendedExpansion,
    currentStatuses: evidence.surfaceFamilies
  };

  const structuralAreas = [
    structuralArea({
      id: 'browser_realism',
      label: 'Browser realism',
      metrics: {
        browserChecks: metricGaps.browserChecks,
        realBrowserChecks: metricGaps.realBrowserChecks,
        browserJourneyFamilies: metricGaps.browserJourneyFamilies
      }
    }),
    structuralArea({
      id: 'integration_realism',
      label: 'Integration realism / ecosystem depth',
      metrics: {
        integrationSurfaceFamilies: metricGaps.integrationSurfaceFamilies,
        liveHttpChecks: metricGaps.liveHttpChecks,
        parityChecks: metricGaps.parityChecks
      }
    }),
    structuralArea({
      id: 'enterprise_governance',
      label: 'Enterprise / admin / compliance breadth',
      metrics: {
        enterpriseSurfaceFamilies: metricGaps.enterpriseSurfaceFamilies,
        surfaceFamiliesComplete: metricGaps.surfaceFamiliesComplete,
        artifactClasses: metricGaps.artifactClasses
      }
    }),
    structuralArea({
      id: 'architecture_scale',
      label: 'Architecture / package / route / module scale',
      metrics: {
        packageCount: metricGaps.packageCount,
        moduleRoots: metricGaps.moduleRoots,
        routeFiles: metricGaps.routeFiles,
        domainFiles: metricGaps.domainFiles,
        productFiles: metricGaps.productFiles,
        productLines: metricGaps.productLines
      }
    }),
    structuralArea({
      id: 'evidence_realism',
      label: 'Artifact depth / evidence realism / operational proof',
      metrics: {
        testFiles: metricGaps.testFiles,
        testLines: metricGaps.testLines,
        evidenceArtifacts: metricGaps.evidenceArtifacts,
        artifactClasses: metricGaps.artifactClasses,
        appCount: metricGaps.appCount
      }
    })
  ];

  const unmetMetrics = Object.entries(metricGaps).filter(([, gap]) => !gap.metMinimum).map(([id, gap]) => ({ id, ...gap }));
  const unmetScores = Object.entries(scoreGaps).filter(([, gap]) => !gap.met).map(([id, gap]) => ({ id, ...gap }));
  const unmetQualitative = Object.entries(qualitativeGaps).filter(([, gap]) => !gap.met).map(([id, gap]) => ({ id, ...gap }));
  const blockerReasons = [
    ...unmetMetrics.map((entry) => `${entry.id}_below_minimum`),
    ...unmetScores.map((entry) => `${entry.id}_below_score_target`),
    ...unmetQualitative.map((entry) => `${entry.id}_not_met`),
    ...missingRequired.map((familyId) => `missing_surface_family:${familyId}`)
  ];

  const minimumCoverageRatios = [
    ...Object.values(metricGaps).map((gap) => gap.percentOfMinimum),
    ...Object.values(scoreGaps).map((gap) => (gap.minimumRequired === 0 ? 1 : Number((gap.current / gap.minimumRequired).toFixed(3))))
  ];
  const weightedCoverage = minimumCoverageRatios.length > 0
    ? Number((minimumCoverageRatios.reduce((sum, value) => sum + value, 0) / minimumCoverageRatios.length).toFixed(3))
    : 1;

  return {
    generatedAt: new Date().toISOString(),
    repoRoot: evidence.repoRoot,
    targetClaim,
    currentClaim: evidence.truthSummary?.highestAllowedClaim || null,
    thresholdModelVersion: model.version,
    currentEvidence: evidence,
    metricGaps,
    scoreGaps,
    qualitativeGaps,
    surfaceFamilies,
    structuralGaps: {
      areas: structuralAreas,
      browserCoverage: evidence.browserCoverage,
      artifactCoverage: evidence.artifactCoverage,
      structuralCoverage: evidence.structuralCoverage
    },
    summary: {
      eligibleForTargetClaim: blockerReasons.length === 0,
      totalUnmetMetrics: unmetMetrics.length,
      totalUnmetScores: unmetScores.length,
      totalUnmetQualitative: unmetQualitative.length,
      totalMissingRequiredFamilies: missingRequired.length,
      blockerReasons,
      weightedCoverage,
      strongestStructuralBlockers: structuralAreas
        .filter((area) => !area.met)
        .sort((a, b) => b.unmetMetrics.length - a.unmetMetrics.length)
        .map((area) => ({ id: area.id, label: area.label, unmetMetrics: area.unmetMetrics.map((entry) => entry.id) })),
      posture: blockerReasons.length === 0
        ? 'target_claim_ready'
        : evidence.truthSummary?.highestAllowedClaim === 'scoped_parity'
          ? 'scoped_parity_far_below_target_claim'
          : 'below_scoped_parity'
    }
  };
}
