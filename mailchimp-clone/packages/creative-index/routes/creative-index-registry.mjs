import { buildCreativeIndexSnapshot, createCreativeIndexRouteSummary } from '../service-creative-index.mjs';

export function createCreativeIndexRegistryRoutes(basePath = '/registry/creative-index') {
  const snapshot = buildCreativeIndexSnapshot();
  return [
    { id: 'creative-index.registry.summary', method: 'GET', path: basePath, summary: createCreativeIndexRouteSummary(snapshot) },
    { id: 'creative-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

