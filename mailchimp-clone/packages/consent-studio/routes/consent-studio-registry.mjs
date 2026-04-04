import { buildConsentStudioSnapshot, createConsentStudioRouteSummary } from '../service-consent-studio.mjs';

export function createConsentStudioRegistryRoutes(basePath = '/registry/consent-studio') {
  const snapshot = buildConsentStudioSnapshot();
  return [
    { id: 'consent-studio.registry.summary', method: 'GET', path: basePath, summary: createConsentStudioRouteSummary(snapshot) },
    { id: 'consent-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

