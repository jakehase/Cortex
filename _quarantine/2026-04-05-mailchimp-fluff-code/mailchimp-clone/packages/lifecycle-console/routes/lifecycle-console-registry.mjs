import { buildLifecycleConsoleSnapshot, createLifecycleConsoleRouteSummary } from '../service-lifecycle-console.mjs';

export function createLifecycleConsoleRegistryRoutes(basePath = '/registry/lifecycle-console') {
  const snapshot = buildLifecycleConsoleSnapshot();
  return [
    { id: 'lifecycle-console.registry.summary', method: 'GET', path: basePath, summary: createLifecycleConsoleRouteSummary(snapshot) },
    { id: 'lifecycle-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

