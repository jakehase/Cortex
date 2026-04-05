import { buildContentConsoleSnapshot, createContentConsoleRouteSummary } from '../service-content-console.mjs';

export function createContentConsoleRegistryRoutes(basePath = '/registry/content-console') {
  const snapshot = buildContentConsoleSnapshot();
  return [
    { id: 'content-console.registry.summary', method: 'GET', path: basePath, summary: createContentConsoleRouteSummary(snapshot) },
    { id: 'content-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'content-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

