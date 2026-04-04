import { buildCustomerSentinelSnapshot, createCustomerSentinelReadinessBoard } from '../service-customer-sentinel.mjs';

export function createCustomerSentinelOpsRoutes(basePath = '/ops/customer-sentinel') {
  const snapshot = buildCustomerSentinelSnapshot();
  return [
    { id: 'customer-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerSentinelReadinessBoard(snapshot) },
    { id: 'customer-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

