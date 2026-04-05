import { buildEcommercePlannerSnapshot, createEcommercePlannerApiDocument } from '../service-ecommerce-planner.mjs';

export function createEcommercePlannerApiRoutes(basePath = '/api/ecommerce-planner') {
  const snapshot = buildEcommercePlannerSnapshot();
  return [
    { id: 'ecommerce-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-planner.api.document', method: 'GET', path: basePath + '/document', document: createEcommercePlannerApiDocument(snapshot) }
  ];
}

