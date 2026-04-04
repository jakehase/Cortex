import { buildLifecycleGridSnapshot, createLifecycleGridRouteSummary } from '../service-lifecycle-grid.mjs';

export function createLifecycleGridRegistryRoutes(basePath = '/registry/lifecycle-grid') {
  const snapshot = buildLifecycleGridSnapshot();
  return [
    { id: 'lifecycle-grid.registry.summary', method: 'GET', path: basePath, summary: createLifecycleGridRouteSummary(snapshot) },
    { id: 'lifecycle-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

