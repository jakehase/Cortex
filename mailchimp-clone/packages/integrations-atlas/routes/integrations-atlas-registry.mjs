import { buildIntegrationsAtlasSnapshot, createIntegrationsAtlasRouteSummary } from '../service-integrations-atlas.mjs';

export function createIntegrationsAtlasRegistryRoutes(basePath = '/registry/integrations-atlas') {
  const snapshot = buildIntegrationsAtlasSnapshot();
  return [
    { id: 'integrations-atlas.registry.summary', method: 'GET', path: basePath, summary: createIntegrationsAtlasRouteSummary(snapshot) },
    { id: 'integrations-atlas.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'integrations-atlas.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

