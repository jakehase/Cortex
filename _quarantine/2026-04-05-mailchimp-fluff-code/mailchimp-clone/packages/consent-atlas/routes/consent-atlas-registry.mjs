import { buildConsentAtlasSnapshot, createConsentAtlasRouteSummary } from '../service-consent-atlas.mjs';

export function createConsentAtlasRegistryRoutes(basePath = '/registry/consent-atlas') {
  const snapshot = buildConsentAtlasSnapshot();
  return [
    { id: 'consent-atlas.registry.summary', method: 'GET', path: basePath, summary: createConsentAtlasRouteSummary(snapshot) },
    { id: 'consent-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'consent-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

