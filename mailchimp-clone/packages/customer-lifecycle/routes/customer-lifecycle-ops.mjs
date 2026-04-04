import { buildCustomerLifecycleSnapshot, createCustomerLifecycleChecklist } from '../service-customer-lifecycle.mjs';

export function createCustomerLifecycleOpsRoutes(basePath = '/ops/customer-lifecycle') {
  const snapshot = buildCustomerLifecycleSnapshot();
  return [
    { id: 'customer-lifecycle.ops.health', method: 'GET', path: basePath + '/health', checklist: createCustomerLifecycleChecklist(snapshot) },
    { id: 'customer-lifecycle.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'customer-lifecycle.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
