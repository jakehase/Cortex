import { buildCreativeConsoleSnapshot, createCreativeConsoleRouteSummary } from '../service-creative-console.mjs';

export function createCreativeConsoleRegistryRoutes(basePath = '/registry/creative-console') {
  const snapshot = buildCreativeConsoleSnapshot();
  return [
    { id: 'creative-console.registry.summary', method: 'GET', path: basePath, summary: createCreativeConsoleRouteSummary(snapshot) },
    { id: 'creative-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

