import { buildLifecycleWatchtowerSnapshot, createLifecycleWatchtowerRouteSummary } from '../service-lifecycle-watchtower.mjs';

export function createLifecycleWatchtowerRegistryRoutes(basePath = '/registry/lifecycle-watchtower') {
  const snapshot = buildLifecycleWatchtowerSnapshot();
  return [
    { id: 'lifecycle-watchtower.registry.summary', method: 'GET', path: basePath, summary: createLifecycleWatchtowerRouteSummary(snapshot) },
    { id: 'lifecycle-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

