import { buildAttributionPlannerSnapshot, createAttributionPlannerApiDocument } from '../service-attribution-planner.mjs';

export function createAttributionPlannerApiRoutes(basePath = '/api/attribution-planner') {
  const snapshot = buildAttributionPlannerSnapshot();
  return [
    { id: 'attribution-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-planner.api.document', method: 'GET', path: basePath + '/document', document: createAttributionPlannerApiDocument(snapshot) }
  ];
}

