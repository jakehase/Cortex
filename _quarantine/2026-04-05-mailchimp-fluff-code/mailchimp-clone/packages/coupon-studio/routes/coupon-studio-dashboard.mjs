import { buildCouponStudioSnapshot } from '../service-coupon-studio.mjs';

export function createCouponStudioDashboardRoutes(basePath = '/coupon-studio') {
  const snapshot = buildCouponStudioSnapshot();
  return [
    { id: 'coupon-studio.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'coupon-studio.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'coupon-studio.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
