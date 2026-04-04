import { buildCommerceCouponsSnapshot } from '../service-commerce-coupons.mjs';
import { createCommerceCouponsFixtures } from '../fixtures-commerce-coupons.mjs';

export function createCommerceCouponsPublicRoutes(basePath = '/public/commerce-coupons') { const snapshot = buildCommerceCouponsSnapshot(); const fixtures = createCommerceCouponsFixtures(); return [{ id: 'commerce-coupons.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'commerce-coupons.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'commerce-coupons.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }
