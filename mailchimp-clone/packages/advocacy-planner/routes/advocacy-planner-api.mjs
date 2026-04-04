import { buildAdvocacyPlannerSnapshot, createAdvocacyPlannerApiDocument } from '../service-advocacy-planner.mjs';

export function createAdvocacyPlannerApiRoutes(basePath = '/api/advocacy-planner') {
  const snapshot = buildAdvocacyPlannerSnapshot();
  return [
    { id: 'advocacy-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-planner.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyPlannerApiDocument(snapshot) }
  ];
}

