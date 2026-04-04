import { buildCouponStudioSnapshot } from '../service-coupon-studio.mjs';
import { createCouponStudioFixtures } from '../fixtures-coupon-studio.mjs';

export function createCouponStudioPublicRoutes(basePath = '/public/coupon-studio') {
  const snapshot = buildCouponStudioSnapshot();
  const fixtures = createCouponStudioFixtures();
  return [
    { id: 'coupon-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'coupon-studio.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'coupon-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
