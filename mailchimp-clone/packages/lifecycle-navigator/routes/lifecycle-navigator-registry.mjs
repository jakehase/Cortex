import { buildLifecycleNavigatorSnapshot, createLifecycleNavigatorRouteSummary } from '../service-lifecycle-navigator.mjs';

export function createLifecycleNavigatorRegistryRoutes(basePath = '/registry/lifecycle-navigator') {
  const snapshot = buildLifecycleNavigatorSnapshot();
  return [
    { id: 'lifecycle-navigator.registry.summary', method: 'GET', path: basePath, summary: createLifecycleNavigatorRouteSummary(snapshot) },
    { id: 'lifecycle-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

