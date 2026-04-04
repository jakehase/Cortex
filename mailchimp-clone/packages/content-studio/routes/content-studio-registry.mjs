import { buildContentStudioSnapshot, createContentStudioRouteSummary } from '../service-content-studio.mjs';

export function createContentStudioRegistryRoutes(basePath = '/registry/content-studio') {
  const snapshot = buildContentStudioSnapshot();
  return [
    { id: 'content-studio.registry.summary', method: 'GET', path: basePath, summary: createContentStudioRouteSummary(snapshot) },
    { id: 'content-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

