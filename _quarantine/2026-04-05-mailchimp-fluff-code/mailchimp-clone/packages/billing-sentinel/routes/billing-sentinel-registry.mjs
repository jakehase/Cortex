import { buildBillingSentinelSnapshot, createBillingSentinelRouteSummary } from '../service-billing-sentinel.mjs';

export function createBillingSentinelRegistryRoutes(basePath = '/registry/billing-sentinel') {
  const snapshot = buildBillingSentinelSnapshot();
  return [
    { id: 'billing-sentinel.registry.summary', method: 'GET', path: basePath, summary: createBillingSentinelRouteSummary(snapshot) },
    { id: 'billing-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'billing-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

