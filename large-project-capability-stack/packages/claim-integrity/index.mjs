const DIMENSIONS = [
  { id: 'product_diff', label: 'Real product-surface diffs exist', weight: 0.1 },
  { id: 'entrypoint', label: 'Route or entrypoint exists', weight: 0.07 },
  { id: 'ui', label: 'Primary UI exists', weight: 0.1 },
  { id: 'workflow', label: 'Workflow depth exists', weight: 0.2 },
  { id: 'persistence', label: 'Persistence and shared state work', weight: 0.16 },
  { id: 'edge_cases', label: 'Edge cases and regressions are covered', weight: 0.15 },
  { id: 'realism', label: 'Realism or parity proof exists', weight: 0.14 },
  { id: 'evidence_lineage', label: 'Evidence lineage is complete', weight: 0.08 }
];

const STATUS_PRESETS = {
  missing: {},
  route_only: { product_diff: 0.4, entrypoint: 1, ui: 0.1 },
  ui_stub: { product_diff: 0.5, entrypoint: 1, ui: 0.5, workflow: 0.1 },
  workflow_partial: { product_diff: 1, entrypoint: 1, ui: 0.75, workflow: 0.35, persistence: 0.15, edge_cases: 0.1 },
  persisted_partial: { product_diff: 1, entrypoint: 1, ui: 0.8, workflow: 0.5, persistence: 0.45, edge_cases: 0.2, realism: 0.1 },
  realism_partial: { product_diff: 1, entrypoint: 1, ui: 0.9, workflow: 0.7, persistence: 0.6, edge_cases: 0.45, realism: 0.45 },
  complete: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension.id, 1]))
};

const EXECUTION_DIMENSIONS = [
  { id: 'control_plane_ready', weight: 1 },
  { id: 'execution_plane_ready', weight: 1 },
  { id: 'supervisor_truth', weight: 1 },
  { id: 'notifier_truth', weight: 0.75 },
  { id: 'repo_qualification', weight: 1 },
  { id: 'recovery_proven', weight: 0.75 },
  { id: 'no_null_blocker_contradiction', weight: 1 }
];

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function weightedAverage(entries) {
  const totalWeight = entries.reduce((sum, entry) => sum + (entry.weight || 0), 0);
  if (totalWeight <= 0) return 0;
  const total = entries.reduce((sum, entry) => sum + ((entry.value || 0) * (entry.weight || 0)), 0);
  return total / totalWeight;
}

function geometricMean(values) {
  const safe = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (safe.length === 0) return 0;
  if (safe.some((value) => value === 0)) return 0;
  const sum = safe.reduce((acc, value) => acc + Math.log(value), 0);
  return Math.exp(sum / safe.length);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function lineageCompleteness(lineage = {}) {
  const hasChangedFiles = Array.isArray(lineage.changedProductFiles) && lineage.changedProductFiles.length > 0;
  const hasProofArtifacts = Array.isArray(lineage.proofArtifacts) && lineage.proofArtifacts.length > 0;
  if (!hasChangedFiles && !hasProofArtifacts) return 0;
  const checks = [
    typeof lineage.targetReference === 'string' && lineage.targetReference.trim().length > 0,
    hasChangedFiles,
    hasProofArtifacts,
    Number.isFinite(lineage.confidence),
    Array.isArray(lineage.missingAdjacent)
  ];
  return checks.filter(Boolean).length / checks.length;
}

function normalizeLeafDimensions(leaf = {}) {
  const preset = STATUS_PRESETS[leaf.currentState] || {};
  const explicit = leaf.dimensions || {};
  const lineageValue = explicit.evidence_lineage ?? (leaf.lineageScore ?? lineageCompleteness(leaf.evidence));
  return Object.fromEntries(DIMENSIONS.map((dimension) => [
    dimension.id,
    clamp01(explicit[dimension.id] ?? preset[dimension.id] ?? (dimension.id === 'evidence_lineage' ? lineageValue : 0))
  ]));
}

function classifyLeaf(score) {
  if (score >= 0.999) return 'complete';
  if (score >= 0.65) return 'advanced';
  if (score > 0) return 'partial';
  return 'missing';
}

function summarizeLeaf(leaf = {}) {
  const dimensions = normalizeLeafDimensions(leaf);
  const dimensionScores = DIMENSIONS.map((dimension) => ({
    id: dimension.id,
    label: dimension.label,
    weight: dimension.weight,
    value: dimensions[dimension.id]
  }));
  const score = weightedAverage(dimensionScores);
  const realism = dimensions.realism;
  const lineage = dimensions.evidence_lineage;
  const started = score > 0;
  const criticalMissing = score < 0.35;
  return {
    id: leaf.id,
    label: leaf.label || leaf.id,
    weight: Number(leaf.weight || 1),
    currentState: leaf.currentState || classifyLeaf(score),
    score: round(score),
    realism: round(realism),
    lineage: round(lineage),
    started,
    criticalMissing,
    evidence: {
      targetReference: leaf.evidence?.targetReference || null,
      changedProductFiles: normalizeArray(leaf.evidence?.changedProductFiles),
      proofArtifacts: normalizeArray(leaf.evidence?.proofArtifacts),
      confidence: Number.isFinite(leaf.evidence?.confidence) ? round(leaf.evidence.confidence) : null,
      missingAdjacent: normalizeArray(leaf.evidence?.missingAdjacent)
    },
    dimensionScores
  };
}

function summarizeSurface(surface = {}) {
  const leaves = normalizeArray(surface.leaves).map(summarizeLeaf);
  const weight = Number(surface.weight || 1);
  const score = weightedAverage(leaves.map((leaf) => ({ value: leaf.score, weight: leaf.weight })));
  const coverage = weightedAverage(leaves.map((leaf) => ({ value: leaf.started ? 1 : 0, weight: leaf.weight })));
  const realism = weightedAverage(leaves.map((leaf) => ({ value: leaf.realism, weight: leaf.weight })));
  const lineage = weightedAverage(leaves.map((leaf) => ({ value: leaf.lineage, weight: leaf.weight })));
  const criticalMissingCount = leaves.filter((leaf) => leaf.criticalMissing).length;
  return {
    id: surface.id,
    label: surface.label || surface.id,
    weight,
    score: round(score),
    coverage: round(coverage),
    realism: round(realism),
    lineage: round(lineage),
    currentState: surface.currentState || (score === 0 ? 'open' : score >= 0.999 ? 'complete' : 'partial'),
    leaves,
    leafCount: leaves.length,
    criticalMissingCount,
    status: score === 0 ? 'open' : score >= 0.999 ? 'complete' : 'partial'
  };
}

function summarizeExecutionReadiness(readiness = {}) {
  const entries = EXECUTION_DIMENSIONS.map((dimension) => ({
    id: dimension.id,
    weight: dimension.weight,
    value: clamp01(readiness[dimension.id])
  }));
  const score = weightedAverage(entries);
  return {
    score: round(score),
    entries: entries.map((entry) => ({ ...entry, value: round(entry.value) }))
  };
}

function buildNegativeSpaceLedger(surfaces = []) {
  const entries = [];
  for (const surface of surfaces) {
    for (const leaf of surface.leaves) {
      if (leaf.score >= 0.999) continue;
      entries.push({
        surfaceId: surface.id,
        surfaceLabel: surface.label,
        leafId: leaf.id,
        leafLabel: leaf.label,
        score: leaf.score,
        realism: leaf.realism,
        lineage: leaf.lineage,
        critical: leaf.criticalMissing,
        missingAdjacent: leaf.evidence.missingAdjacent
      });
    }
  }
  return {
    totalEntries: entries.length,
    criticalEntries: entries.filter((entry) => entry.critical).length,
    entries: entries.sort((a, b) => a.score - b.score || a.surfaceLabel.localeCompare(b.surfaceLabel))
  };
}

function computeAxes({ surfaces, execution }) {
  const weightedSurfaceScore = weightedAverage(surfaces.map((surface) => ({ value: surface.score, weight: surface.weight })));
  const weightedCoverage = weightedAverage(surfaces.map((surface) => ({ value: surface.coverage, weight: surface.weight })));
  const weightedRealism = weightedAverage(surfaces.map((surface) => ({ value: surface.realism, weight: surface.weight })));
  const weightedLineage = weightedAverage(surfaces.map((surface) => ({ value: surface.lineage, weight: surface.weight })));
  return {
    executionReadiness: round(execution.score),
    productSurfaceCoverage: round(weightedCoverage),
    depthParityQuality: round(weightedSurfaceScore),
    verifiedRealism: round(weightedRealism),
    evidenceLineage: round(weightedLineage)
  };
}

function computeProgress({ surfaces, axes, negativeSpace }) {
  const productAxes = [axes.productSurfaceCoverage, axes.depthParityQuality, axes.verifiedRealism, axes.evidenceLineage].map((value) => Math.max(value, 0.02));
  const productRaw = geometricMean(productAxes);
  const sortedSurfaceScores = surfaces.map((surface) => surface.score).sort((a, b) => a - b);
  const weakestCount = Math.max(1, Math.ceil(sortedSurfaceScores.length / 4));
  const weakestAverage = sortedSurfaceScores.slice(0, weakestCount).reduce((sum, score) => sum + score, 0) / weakestCount;
  const totalLeaves = surfaces.reduce((sum, surface) => sum + surface.leafCount, 0);
  const criticalMissingRatio = totalLeaves > 0 ? negativeSpace.criticalEntries / totalLeaves : 1;
  const negativeSpacePenalty = Math.max(0.05, 1 - criticalMissingRatio);
  const productProgress = productRaw * (0.6 + (0.4 * weakestAverage)) * negativeSpacePenalty;
  const campaignReadiness = geometricMean([Math.max(productProgress, 0.001), Math.max(axes.executionReadiness, 0.001)]);
  const confidence = Math.min(1, axes.evidenceLineage * Math.min(1, Math.sqrt(totalLeaves / 40)));
  return {
    cloneParityPercent: round(productProgress * 100, 1),
    campaignReadinessPercent: round(campaignReadiness * 100, 1),
    confidencePercent: round(confidence * 100, 1),
    diagnostics: {
      productRaw: round(productRaw),
      weakestQuartileAverage: round(weakestAverage),
      criticalMissingRatio: round(criticalMissingRatio),
      negativeSpacePenalty: round(negativeSpacePenalty)
    }
  };
}

function higherEstimateRequirements(surfaces = [], thresholds = [10, 25, 50]) {
  const incomplete = surfaces
    .flatMap((surface) => surface.leaves
      .filter((leaf) => leaf.score < 0.999)
      .map((leaf) => ({ surface, leaf })))
    .sort((a, b) => (a.leaf.score - b.leaf.score) || (b.surface.weight - a.surface.weight));

  return Object.fromEntries(thresholds.map((threshold) => {
    const count = threshold <= 10 ? 8 : threshold <= 25 ? 18 : 32;
    const needed = incomplete.slice(0, count).map(({ surface, leaf }) => `${surface.label}: ${leaf.label}`);
    return [threshold, needed];
  }));
}

export function buildAdversarialAudit(report, { proposedPercent = null } = {}) {
  const weakestSurfaces = [...report.surfaces]
    .sort((a, b) => a.score - b.score || b.weight - a.weight)
    .slice(0, 5)
    .map((surface) => ({
      id: surface.id,
      label: surface.label,
      score: surface.score,
      criticalMissingCount: surface.criticalMissingCount
    }));

  const strongestCounterexamples = report.negativeSpace.entries.slice(0, 12).map((entry) => ({
    surface: entry.surfaceLabel,
    leaf: entry.leafLabel,
    score: entry.score,
    missingAdjacent: entry.missingAdjacent
  }));

  const reasons = [];
  if (report.axes.executionReadiness > report.axes.depthParityQuality + 0.35) reasons.push('execution_readiness_outpaces_product_parity');
  if (report.negativeSpace.criticalEntries > 0) reasons.push('large_negative_space_remains');
  if (report.axes.verifiedRealism < 0.2) reasons.push('realism_proof_is_sparse');
  if (report.axes.evidenceLineage < 0.75) reasons.push('evidence_lineage_is_incomplete');
  if (Number.isFinite(proposedPercent) && proposedPercent > report.progress.cloneParityPercent + 3) reasons.push('proposed_percent_exceeds_artifact_backed_estimate');

  return {
    reasonsEstimateMayBeTooHigh: [...new Set(reasons)],
    weakestSurfaces,
    strongestCounterexamples,
    higherEstimateRequirements: higherEstimateRequirements(report.surfaces)
  };
}

export function buildClaimResponseFrame(report, { proposedPercent = null } = {}) {
  return {
    observed: {
      axes: report.axes,
      negativeSpace: {
        totalEntries: report.negativeSpace.totalEntries,
        criticalEntries: report.negativeSpace.criticalEntries
      }
    },
    estimated: {
      cloneParityPercent: report.progress.cloneParityPercent,
      campaignReadinessPercent: report.progress.campaignReadinessPercent,
      proposedPercent
    },
    confidence: {
      percent: report.progress.confidencePercent,
      note: report.progress.confidencePercent >= 75 ? 'artifact-backed' : 'estimate is still coarse and should be treated conservatively'
    },
    missing: report.negativeSpace.entries.slice(0, 10).map((entry) => `${entry.surfaceLabel}: ${entry.leafLabel}`),
    higherEstimateRequirements: buildAdversarialAudit(report, { proposedPercent }).higherEstimateRequirements
  };
}

export function compileClaimIntegrityReport({
  title = 'claim_integrity_report',
  anchor = null,
  targetPath = null,
  requestedFidelity = null,
  requestedClaim = null,
  executionReadiness = {},
  surfaces = []
} = {}) {
  const summarizedSurfaces = normalizeArray(surfaces).map(summarizeSurface);
  const execution = summarizeExecutionReadiness(executionReadiness);
  const axes = computeAxes({ surfaces: summarizedSurfaces, execution });
  const negativeSpace = buildNegativeSpaceLedger(summarizedSurfaces);
  const progress = computeProgress({ surfaces: summarizedSurfaces, axes, negativeSpace });
  const report = {
    generatedAt: new Date().toISOString(),
    title,
    anchor,
    targetPath,
    requestedFidelity,
    requestedClaim,
    dimensions: DIMENSIONS,
    executionReadiness: execution,
    axes,
    surfaces: summarizedSurfaces,
    negativeSpace,
    progress
  };
  return {
    ...report,
    adversarialAudit: buildAdversarialAudit(report)
  };
}

export const DEFAULT_DIMENSIONS = DIMENSIONS;
export const DEFAULT_STATUS_PRESETS = STATUS_PRESETS;
