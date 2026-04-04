import { buildCommerceCouponsSnapshot } from '../service-commerce-coupons.mjs';

export function createCommerceCouponsDashboardRoutes(basePath = '/commerce-coupons') { const snapshot = buildCommerceCouponsSnapshot(); return [{ id: 'commerce-coupons.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'commerce-coupons.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'commerce-coupons.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }
