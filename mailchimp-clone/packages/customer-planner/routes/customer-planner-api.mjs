import { buildCustomerPlannerSnapshot, createCustomerPlannerApiDocument } from '../service-customer-planner.mjs';

export function createCustomerPlannerApiRoutes(basePath = '/api/customer-planner') {
  const snapshot = buildCustomerPlannerSnapshot();
  return [
    { id: 'customer-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-planner.api.document', method: 'GET', path: basePath + '/document', document: createCustomerPlannerApiDocument(snapshot) }
  ];
}

