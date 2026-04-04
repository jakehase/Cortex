import { buildCouponStudioSnapshot, createCouponStudioChecklist } from '../service-coupon-studio.mjs';

export function createCouponStudioOpsRoutes(basePath = '/ops/coupon-studio') {
  const snapshot = buildCouponStudioSnapshot();
  return [
    { id: 'coupon-studio.ops.health', method: 'GET', path: basePath + '/health', checklist: createCouponStudioChecklist(snapshot) },
    { id: 'coupon-studio.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'coupon-studio.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
