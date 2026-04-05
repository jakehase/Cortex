import { buildConsentHubSnapshot, createConsentHubRouteSummary } from '../service-consent-hub.mjs';

export function createConsentHubRegistryRoutes(basePath = '/registry/consent-hub') {
  const snapshot = buildConsentHubSnapshot();
  return [
    { id: 'consent-hub.registry.summary', method: 'GET', path: basePath, summary: createConsentHubRouteSummary(snapshot) },
    { id: 'consent-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

