import { buildBillingPlannerSnapshot, createBillingPlannerApiDocument } from '../service-billing-planner.mjs';

export function createBillingPlannerApiRoutes(basePath = '/api/billing-planner') {
  const snapshot = buildBillingPlannerSnapshot();
  return [
    { id: 'billing-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-planner.api.document', method: 'GET', path: basePath + '/document', document: createBillingPlannerApiDocument(snapshot) }
  ];
}

