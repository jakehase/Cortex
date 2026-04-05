import { buildConsentNavigatorSnapshot, createConsentNavigatorRouteSummary } from '../service-consent-navigator.mjs';

export function createConsentNavigatorRegistryRoutes(basePath = '/registry/consent-navigator') {
  const snapshot = buildConsentNavigatorSnapshot();
  return [
    { id: 'consent-navigator.registry.summary', method: 'GET', path: basePath, summary: createConsentNavigatorRouteSummary(snapshot) },
    { id: 'consent-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

