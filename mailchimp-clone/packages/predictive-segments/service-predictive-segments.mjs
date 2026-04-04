import { createPredictiveSegmentsWorkspace, summarizePredictiveSegments, createPredictiveSegmentsNarratives } from './domain-predictive-segments.mjs';
import { createPredictiveSegmentsPolicies, validatePredictiveSegmentsPolicies, policySummaryPredictiveSegments } from './domain-predictive-segments-policies.mjs';

export function buildPredictiveSegmentsSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createPredictiveSegmentsWorkspace(workspaceName);
  const policies = createPredictiveSegmentsPolicies();
  return { workspace, summary: summarizePredictiveSegments(workspace), narratives: createPredictiveSegmentsNarratives(workspace), policies, policySummary: policySummaryPredictiveSegments(policies), validation: validatePredictiveSegmentsPolicies(policies) };
}

export function createPredictiveSegmentsChecklist(snapshot = buildPredictiveSegmentsSnapshot()) {
  return [
    { id: "predictive-segments-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "predictive-segments-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "predictive-segments-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createPredictiveSegmentsApiDocument(snapshot = buildPredictiveSegmentsSnapshot()) {
  return {
    id: "predictive-segments-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/predictive-segments/overview' },
      { method: 'POST', path: '/api/predictive-segments/validate' },
      { method: 'GET', path: '/api/predictive-segments/policies' }
    ],
    checklist: createPredictiveSegmentsChecklist(snapshot)
  };
}

