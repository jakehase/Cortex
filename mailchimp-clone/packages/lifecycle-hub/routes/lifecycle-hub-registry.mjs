import { buildLifecycleHubSnapshot, createLifecycleHubRouteSummary } from '../service-lifecycle-hub.mjs';

export function createLifecycleHubRegistryRoutes(basePath = '/registry/lifecycle-hub') {
  const snapshot = buildLifecycleHubSnapshot();
  return [
    { id: 'lifecycle-hub.registry.summary', method: 'GET', path: basePath, summary: createLifecycleHubRouteSummary(snapshot) },
    { id: 'lifecycle-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

