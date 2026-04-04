import { createRevenueOpsBrief, validateRevenueOpsPlan } from '../domain-revenue-ops.mjs';

export function createRevenueOpsApiRoutes(basePath = '/api/revenue-ops') {
  const sample = createRevenueOpsBrief();
  return [
    { id: 'revenue-ops.brief', method: 'POST', path: basePath + '/brief', sample },
    { id: 'revenue-ops.validate', method: 'POST', path: basePath + '/validate', validation: validateRevenueOpsPlan(sample) }
  ];
}
