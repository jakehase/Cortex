import { buildLifecycleIndexSnapshot, createLifecycleIndexRouteSummary } from '../service-lifecycle-index.mjs';

export function createLifecycleIndexRegistryRoutes(basePath = '/registry/lifecycle-index') {
  const snapshot = buildLifecycleIndexSnapshot();
  return [
    { id: 'lifecycle-index.registry.summary', method: 'GET', path: basePath, summary: createLifecycleIndexRouteSummary(snapshot) },
    { id: 'lifecycle-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

