import { buildConsentGridSnapshot, createConsentGridRouteSummary } from '../service-consent-grid.mjs';

export function createConsentGridRegistryRoutes(basePath = '/registry/consent-grid') {
  const snapshot = buildConsentGridSnapshot();
  return [
    { id: 'consent-grid.registry.summary', method: 'GET', path: basePath, summary: createConsentGridRouteSummary(snapshot) },
    { id: 'consent-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

