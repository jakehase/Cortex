import { buildAdvocacyConsoleSnapshot, createAdvocacyConsoleRouteSummary } from '../service-advocacy-console.mjs';

export function createAdvocacyConsoleRegistryRoutes(basePath = '/registry/advocacy-console') {
  const snapshot = buildAdvocacyConsoleSnapshot();
  return [
    { id: 'advocacy-console.registry.summary', method: 'GET', path: basePath, summary: createAdvocacyConsoleRouteSummary(snapshot) },
    { id: 'advocacy-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'advocacy-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

