import { buildContentIndexSnapshot, createContentIndexRouteSummary } from '../service-content-index.mjs';

export function createContentIndexRegistryRoutes(basePath = '/registry/content-index') {
  const snapshot = buildContentIndexSnapshot();
  return [
    { id: 'content-index.registry.summary', method: 'GET', path: basePath, summary: createContentIndexRouteSummary(snapshot) },
    { id: 'content-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

