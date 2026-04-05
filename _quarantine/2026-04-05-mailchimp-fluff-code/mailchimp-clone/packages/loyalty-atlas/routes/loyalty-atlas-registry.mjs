import { buildLoyaltyAtlasSnapshot, createLoyaltyAtlasRouteSummary } from '../service-loyalty-atlas.mjs';

export function createLoyaltyAtlasRegistryRoutes(basePath = '/registry/loyalty-atlas') {
  const snapshot = buildLoyaltyAtlasSnapshot();
  return [
    { id: 'loyalty-atlas.registry.summary', method: 'GET', path: basePath, summary: createLoyaltyAtlasRouteSummary(snapshot) },
    { id: 'loyalty-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

