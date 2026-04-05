import { buildCustomerSentinelSnapshot, createCustomerSentinelRouteSummary } from '../service-customer-sentinel.mjs';

export function createCustomerSentinelRegistryRoutes(basePath = '/registry/customer-sentinel') {
  const snapshot = buildCustomerSentinelSnapshot();
  return [
    { id: 'customer-sentinel.registry.summary', method: 'GET', path: basePath, summary: createCustomerSentinelRouteSummary(snapshot) },
    { id: 'customer-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'customer-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

