import { buildBillingSentinelSnapshot, createBillingSentinelReadinessBoard } from '../service-billing-sentinel.mjs';

export function createBillingSentinelOpsRoutes(basePath = '/ops/billing-sentinel') {
  const snapshot = buildBillingSentinelSnapshot();
  return [
    { id: 'billing-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingSentinelReadinessBoard(snapshot) },
    { id: 'billing-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

