import { createSocialPublisherWorkspace, summarizeSocialPublisher, createSocialPublisherNarratives } from './domain-social-publisher.mjs';
import { createSocialPublisherPolicies, validateSocialPublisherPolicies, policySummarySocialPublisher } from './domain-social-publisher-policies.mjs';

export function buildSocialPublisherSnapshot(workspaceName = 'Continuation workspace') {
  const workspace = createSocialPublisherWorkspace(workspaceName);
  const policies = createSocialPublisherPolicies();
  return { workspace, summary: summarizeSocialPublisher(workspace), narratives: createSocialPublisherNarratives(workspace), policies, policySummary: policySummarySocialPublisher(policies), validation: validateSocialPublisherPolicies(policies) };
}

export function createSocialPublisherChecklist(snapshot = buildSocialPublisherSnapshot()) {
  return [
    { id: 'social-publisher-check-1', label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: 'social-publisher-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'social-publisher-check-3', label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createSocialPublisherApiDocument(snapshot = buildSocialPublisherSnapshot()) {
  return { id: 'social-publisher-api', headline: snapshot.summary.name + ' API contract', endpoints: [{ method: 'GET', path: '/api/social-publisher/overview' }, { method: 'POST', path: '/api/social-publisher/validate' }, { method: 'GET', path: '/api/social-publisher/policies' }], checklist: createSocialPublisherChecklist(snapshot) };
}
