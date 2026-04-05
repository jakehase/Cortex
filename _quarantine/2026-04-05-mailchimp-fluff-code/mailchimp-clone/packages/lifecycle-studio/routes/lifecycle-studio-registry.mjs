import { buildLifecycleStudioSnapshot, createLifecycleStudioRouteSummary } from '../service-lifecycle-studio.mjs';

export function createLifecycleStudioRegistryRoutes(basePath = '/registry/lifecycle-studio') {
  const snapshot = buildLifecycleStudioSnapshot();
  return [
    { id: 'lifecycle-studio.registry.summary', method: 'GET', path: basePath, summary: createLifecycleStudioRouteSummary(snapshot) },
    { id: 'lifecycle-studio.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-studio.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

