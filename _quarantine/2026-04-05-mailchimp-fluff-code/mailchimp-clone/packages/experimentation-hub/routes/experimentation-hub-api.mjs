import { buildExperimentationHubSnapshot, createExperimentationHubApiDocument } from '../service-experimentation-hub.mjs';

export function createExperimentationHubApiRoutes(basePath = '/api/experimentation-hub') {
  const snapshot = buildExperimentationHubSnapshot();
  return [
    { id: 'experimentation-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-hub.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationHubApiDocument(snapshot) }
  ];
}

