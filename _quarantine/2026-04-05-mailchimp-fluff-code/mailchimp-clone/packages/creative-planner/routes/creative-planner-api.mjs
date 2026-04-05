import { buildCreativePlannerSnapshot, createCreativePlannerApiDocument } from '../service-creative-planner.mjs';

export function createCreativePlannerApiRoutes(basePath = '/api/creative-planner') {
  const snapshot = buildCreativePlannerSnapshot();
  return [
    { id: 'creative-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-planner.api.document', method: 'GET', path: basePath + '/document', document: createCreativePlannerApiDocument(snapshot) }
  ];
}

