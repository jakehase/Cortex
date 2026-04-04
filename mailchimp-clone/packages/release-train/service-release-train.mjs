import { createReleaseTrainWorkspace, summarizeReleaseTrain, createReleaseTrainNarratives } from './domain-release-train.mjs';
import { createReleaseTrainPolicies, validateReleaseTrainPolicies, policySummaryReleaseTrain } from './domain-release-train-policies.mjs';

export function buildReleaseTrainSnapshot(workspaceName = 'Continuation workspace') {
  const workspace = createReleaseTrainWorkspace(workspaceName);
  const policies = createReleaseTrainPolicies();
  return { workspace, summary: summarizeReleaseTrain(workspace), narratives: createReleaseTrainNarratives(workspace), policies, policySummary: policySummaryReleaseTrain(policies), validation: validateReleaseTrainPolicies(policies) };
}

export function createReleaseTrainChecklist(snapshot = buildReleaseTrainSnapshot()) {
  return [
    { id: 'release-train-check-1', label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: 'release-train-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'release-train-check-3', label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createReleaseTrainApiDocument(snapshot = buildReleaseTrainSnapshot()) {
  return { id: 'release-train-api', headline: snapshot.summary.name + ' API contract', endpoints: [{ method: 'GET', path: '/api/release-train/overview' }, { method: 'POST', path: '/api/release-train/validate' }, { method: 'GET', path: '/api/release-train/policies' }], checklist: createReleaseTrainChecklist(snapshot) };
}
