import { buildLifecyclePlannerSnapshot, createLifecyclePlannerApiDocument } from '../service-lifecycle-planner.mjs';

export function createLifecyclePlannerApiRoutes(basePath = '/api/lifecycle-planner') {
  const snapshot = buildLifecyclePlannerSnapshot();
  return [
    { id: 'lifecycle-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-planner.api.document', method: 'GET', path: basePath + '/document', document: createLifecyclePlannerApiDocument(snapshot) }
  ];
}

