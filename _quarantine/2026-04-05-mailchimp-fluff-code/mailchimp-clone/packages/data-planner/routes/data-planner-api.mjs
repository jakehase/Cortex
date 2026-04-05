import { buildDataPlannerSnapshot, createDataPlannerApiDocument } from '../service-data-planner.mjs';

export function createDataPlannerApiRoutes(basePath = '/api/data-planner') {
  const snapshot = buildDataPlannerSnapshot();
  return [
    { id: 'data-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-planner.api.document', method: 'GET', path: basePath + '/document', document: createDataPlannerApiDocument(snapshot) }
  ];
}

