import { buildCreativeSentinelSnapshot, createCreativeSentinelRouteSummary } from '../service-creative-sentinel.mjs';

export function createCreativeSentinelRegistryRoutes(basePath = '/registry/creative-sentinel') {
  const snapshot = buildCreativeSentinelSnapshot();
  return [
    { id: 'creative-sentinel.registry.summary', method: 'GET', path: basePath, summary: createCreativeSentinelRouteSummary(snapshot) },
    { id: 'creative-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'creative-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

