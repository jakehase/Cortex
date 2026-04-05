import { buildEcommerceSentinelSnapshot, createEcommerceSentinelRouteSummary } from '../service-ecommerce-sentinel.mjs';

export function createEcommerceSentinelRegistryRoutes(basePath = '/registry/ecommerce-sentinel') {
  const snapshot = buildEcommerceSentinelSnapshot();
  return [
    { id: 'ecommerce-sentinel.registry.summary', method: 'GET', path: basePath, summary: createEcommerceSentinelRouteSummary(snapshot) },
    { id: 'ecommerce-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'ecommerce-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

