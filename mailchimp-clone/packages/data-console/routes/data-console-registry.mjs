import { buildDataConsoleSnapshot, createDataConsoleRouteSummary } from '../service-data-console.mjs';

export function createDataConsoleRegistryRoutes(basePath = '/registry/data-console') {
  const snapshot = buildDataConsoleSnapshot();
  return [
    { id: 'data-console.registry.summary', method: 'GET', path: basePath, summary: createDataConsoleRouteSummary(snapshot) },
    { id: 'data-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'data-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

