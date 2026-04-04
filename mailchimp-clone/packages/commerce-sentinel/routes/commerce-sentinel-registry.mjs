import { buildCommerceSentinelSnapshot, createCommerceSentinelRouteSummary } from '../service-commerce-sentinel.mjs';

export function createCommerceSentinelRegistryRoutes(basePath = '/registry/commerce-sentinel') {
  const snapshot = buildCommerceSentinelSnapshot();
  return [
    { id: 'commerce-sentinel.registry.summary', method: 'GET', path: basePath, summary: createCommerceSentinelRouteSummary(snapshot) },
    { id: 'commerce-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'commerce-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

