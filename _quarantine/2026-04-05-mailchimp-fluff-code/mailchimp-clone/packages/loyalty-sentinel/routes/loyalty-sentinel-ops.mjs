import { buildLoyaltySentinelSnapshot, createLoyaltySentinelReadinessBoard } from '../service-loyalty-sentinel.mjs';

export function createLoyaltySentinelOpsRoutes(basePath = '/ops/loyalty-sentinel') {
  const snapshot = buildLoyaltySentinelSnapshot();
  return [
    { id: 'loyalty-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltySentinelReadinessBoard(snapshot) },
    { id: 'loyalty-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

