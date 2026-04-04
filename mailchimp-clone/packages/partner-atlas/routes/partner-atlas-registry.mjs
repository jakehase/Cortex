import { buildPartnerAtlasSnapshot, createPartnerAtlasRouteSummary } from '../service-partner-atlas.mjs';

export function createPartnerAtlasRegistryRoutes(basePath = '/registry/partner-atlas') {
  const snapshot = buildPartnerAtlasSnapshot();
  return [
    { id: 'partner-atlas.registry.summary', method: 'GET', path: basePath, summary: createPartnerAtlasRouteSummary(snapshot) },
    { id: 'partner-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'partner-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

