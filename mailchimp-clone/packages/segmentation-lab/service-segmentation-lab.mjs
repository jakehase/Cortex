import { createSegmentationLabWorkspace, summarizeSegmentationLab, createSegmentationLabNarratives } from './domain-segmentation-lab.mjs';
import { createSegmentationLabPolicies, validateSegmentationLabPolicies, policySummarySegmentationLab } from './domain-segmentation-lab-policies.mjs';

export function buildSegmentationLabSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createSegmentationLabWorkspace(workspaceName);
  const policies = createSegmentationLabPolicies();
  return {
    workspace,
    summary: summarizeSegmentationLab(workspace),
    narratives: createSegmentationLabNarratives(workspace),
    policies,
    policySummary: policySummarySegmentationLab(policies),
    validation: validateSegmentationLabPolicies(policies)
  };
}

export function createSegmentationLabChecklist(snapshot = buildSegmentationLabSnapshot()) {
  return [
    { id: 'segmentation-lab-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'segmentation-lab-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'segmentation-lab-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createSegmentationLabApiDocument(snapshot = buildSegmentationLabSnapshot()) {
  return {
    id: 'segmentation-lab-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/segmentation-lab/overview' },
      { method: 'POST', path: '/api/segmentation-lab/validate' },
      { method: 'GET', path: '/api/segmentation-lab/policies' }
    ],
    checklist: createSegmentationLabChecklist(snapshot)
  };
}
