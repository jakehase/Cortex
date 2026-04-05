import { buildLoyaltySentinelSnapshot, createLoyaltySentinelRouteSummary } from '../service-loyalty-sentinel.mjs';

export function createLoyaltySentinelRegistryRoutes(basePath = '/registry/loyalty-sentinel') {
  const snapshot = buildLoyaltySentinelSnapshot();
  return [
    { id: 'loyalty-sentinel.registry.summary', method: 'GET', path: basePath, summary: createLoyaltySentinelRouteSummary(snapshot) },
    { id: 'loyalty-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'loyalty-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

