import { buildAttributionConsoleSnapshot, createAttributionConsoleRouteSummary } from '../service-attribution-console.mjs';

export function createAttributionConsoleRegistryRoutes(basePath = '/registry/attribution-console') {
  const snapshot = buildAttributionConsoleSnapshot();
  return [
    { id: 'attribution-console.registry.summary', method: 'GET', path: basePath, summary: createAttributionConsoleRouteSummary(snapshot) },
    { id: 'attribution-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'attribution-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

