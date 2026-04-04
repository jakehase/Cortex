import { createTrustCenterBrief, validateTrustCenterPlan } from '../domain-trust-center.mjs';

export function createTrustCenterApiRoutes(basePath = '/api/trust-center') {
  const sample = createTrustCenterBrief();
  return [
    { id: 'trust-center.brief', method: 'POST', path: basePath + '/brief', sample },
    { id: 'trust-center.validate', method: 'POST', path: basePath + '/validate', validation: validateTrustCenterPlan(sample) }
  ];
}
