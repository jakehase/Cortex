import { buildIntegrationsPlannerSnapshot, createIntegrationsPlannerApiDocument } from '../service-integrations-planner.mjs';

export function createIntegrationsPlannerApiRoutes(basePath = '/api/integrations-planner') {
  const snapshot = buildIntegrationsPlannerSnapshot();
  return [
    { id: 'integrations-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-planner.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsPlannerApiDocument(snapshot) }
  ];
}

