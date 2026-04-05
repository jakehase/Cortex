import { buildCouponStudioSnapshot, createCouponStudioApiDocument } from '../service-coupon-studio.mjs';

export function createCouponStudioApiRoutes(basePath = '/api/coupon-studio') {
  const snapshot = buildCouponStudioSnapshot();
  return [
    { id: 'coupon-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'coupon-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'coupon-studio.api.document', method: 'GET', path: basePath + '/document', document: createCouponStudioApiDocument(snapshot) }
  ];
}
