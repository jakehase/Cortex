import { buildContentPlannerSnapshot, createContentPlannerApiDocument } from '../service-content-planner.mjs';

export function createContentPlannerApiRoutes(basePath = '/api/content-planner') {
  const snapshot = buildContentPlannerSnapshot();
  return [
    { id: 'content-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-planner.api.document', method: 'GET', path: basePath + '/document', document: createContentPlannerApiDocument(snapshot) }
  ];
}

