import { buildCommercePlannerSnapshot, createCommercePlannerApiDocument } from '../service-commerce-planner.mjs';

export function createCommercePlannerApiRoutes(basePath = '/api/commerce-planner') {
  const snapshot = buildCommercePlannerSnapshot();
  return [
    { id: 'commerce-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-planner.api.document', method: 'GET', path: basePath + '/document', document: createCommercePlannerApiDocument(snapshot) }
  ];
}

