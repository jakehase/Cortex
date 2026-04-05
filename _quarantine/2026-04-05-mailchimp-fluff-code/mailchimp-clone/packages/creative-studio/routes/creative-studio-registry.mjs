import { buildCreativeStudioSnapshot, createCreativeStudioRouteSummary } from '../service-creative-studio.mjs';

export function createCreativeStudioRegistryRoutes(basePath = '/registry/creative-studio') {
  const snapshot = buildCreativeStudioSnapshot();
  return [
    { id: 'creative-studio.registry.summary', method: 'GET', path: basePath, summary: createCreativeStudioRouteSummary(snapshot) },
    { id: 'creative-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

