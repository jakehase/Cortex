import { createSegmentationQualityWorkspace, summarizeSegmentationQuality, createSegmentationQualityNarratives } from './domain-segmentation-quality.mjs';
import { createSegmentationQualityPolicies, validateSegmentationQualityPolicies, policySummarySegmentationQuality } from './domain-segmentation-quality-policies.mjs';

export function buildSegmentationQualitySnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createSegmentationQualityWorkspace(workspaceName);
  const policies = createSegmentationQualityPolicies();
  return { workspace, summary: summarizeSegmentationQuality(workspace), narratives: createSegmentationQualityNarratives(workspace), policies, policySummary: policySummarySegmentationQuality(policies), validation: validateSegmentationQualityPolicies(policies) };
}

export function createSegmentationQualityChecklist(snapshot = buildSegmentationQualitySnapshot()) {
  return [
    { id: "segmentation-quality-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "segmentation-quality-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "segmentation-quality-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createSegmentationQualityApiDocument(snapshot = buildSegmentationQualitySnapshot()) {
  return {
    id: "segmentation-quality-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/segmentation-quality/overview' },
      { method: 'POST', path: '/api/segmentation-quality/validate' },
      { method: 'GET', path: '/api/segmentation-quality/policies' }
    ],
    checklist: createSegmentationQualityChecklist(snapshot)
  };
}

