import { buildEcommerceSentinelSnapshot, createEcommerceSentinelReadinessBoard } from '../service-ecommerce-sentinel.mjs';

export function createEcommerceSentinelOpsRoutes(basePath = '/ops/ecommerce-sentinel') {
  const snapshot = buildEcommerceSentinelSnapshot();
  return [
    { id: 'ecommerce-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceSentinelReadinessBoard(snapshot) },
    { id: 'ecommerce-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

