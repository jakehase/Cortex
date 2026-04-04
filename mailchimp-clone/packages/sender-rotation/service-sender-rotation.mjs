import { createSenderRotationWorkspace, summarizeSenderRotation, createSenderRotationNarratives } from './domain-sender-rotation.mjs';
import { createSenderRotationPolicies, validateSenderRotationPolicies, policySummarySenderRotation } from './domain-sender-rotation-policies.mjs';

export function buildSenderRotationSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createSenderRotationWorkspace(workspaceName);
  const policies = createSenderRotationPolicies();
  return { workspace, summary: summarizeSenderRotation(workspace), narratives: createSenderRotationNarratives(workspace), policies, policySummary: policySummarySenderRotation(policies), validation: validateSenderRotationPolicies(policies) };
}

export function createSenderRotationChecklist(snapshot = buildSenderRotationSnapshot()) {
  return [
    { id: "sender-rotation-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "sender-rotation-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "sender-rotation-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createSenderRotationApiDocument(snapshot = buildSenderRotationSnapshot()) {
  return {
    id: "sender-rotation-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/sender-rotation/overview' },
      { method: 'POST', path: '/api/sender-rotation/validate' },
      { method: 'GET', path: '/api/sender-rotation/policies' }
    ],
    checklist: createSenderRotationChecklist(snapshot)
  };
}

