import { buildLifecycleSentinelSnapshot, createLifecycleSentinelRouteSummary } from '../service-lifecycle-sentinel.mjs';

export function createLifecycleSentinelRegistryRoutes(basePath = '/registry/lifecycle-sentinel') {
  const snapshot = buildLifecycleSentinelSnapshot();
  return [
    { id: 'lifecycle-sentinel.registry.summary', method: 'GET', path: basePath, summary: createLifecycleSentinelRouteSummary(snapshot) },
    { id: 'lifecycle-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'lifecycle-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

