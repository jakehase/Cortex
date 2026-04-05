import { buildConsentWatchtowerSnapshot, createConsentWatchtowerRouteSummary } from '../service-consent-watchtower.mjs';

export function createConsentWatchtowerRegistryRoutes(basePath = '/registry/consent-watchtower') {
  const snapshot = buildConsentWatchtowerSnapshot();
  return [
    { id: 'consent-watchtower.registry.summary', method: 'GET', path: basePath, summary: createConsentWatchtowerRouteSummary(snapshot) },
    { id: 'consent-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

