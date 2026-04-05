import { buildConsentAdvisorSnapshot, createConsentAdvisorRouteSummary } from '../service-consent-advisor.mjs';

export function createConsentAdvisorRegistryRoutes(basePath = '/registry/consent-advisor') {
  const snapshot = buildConsentAdvisorSnapshot();
  return [
    { id: 'consent-advisor.registry.summary', method: 'GET', path: basePath, summary: createConsentAdvisorRouteSummary(snapshot) },
    { id: 'consent-advisor.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-advisor.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

