import { buildConsentIndexSnapshot, createConsentIndexRouteSummary } from '../service-consent-index.mjs';

export function createConsentIndexRegistryRoutes(basePath = '/registry/consent-index') {
  const snapshot = buildConsentIndexSnapshot();
  return [
    { id: 'consent-index.registry.summary', method: 'GET', path: basePath, summary: createConsentIndexRouteSummary(snapshot) },
    { id: 'consent-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

