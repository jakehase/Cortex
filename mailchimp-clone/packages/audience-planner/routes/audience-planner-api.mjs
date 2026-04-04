import { buildAudiencePlannerSnapshot, createAudiencePlannerApiDocument } from '../service-audience-planner.mjs';

export function createAudiencePlannerApiRoutes(basePath = '/api/audience-planner') {
  const snapshot = buildAudiencePlannerSnapshot();
  return [
    { id: 'audience-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-planner.api.document', method: 'GET', path: basePath + '/document', document: createAudiencePlannerApiDocument(snapshot) }
  ];
}

