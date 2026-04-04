import { buildExperimentationIndexSnapshot, createExperimentationIndexApiDocument } from '../service-experimentation-index.mjs';

export function createExperimentationIndexApiRoutes(basePath = '/api/experimentation-index') {
  const snapshot = buildExperimentationIndexSnapshot();
  return [
    { id: 'experimentation-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-index.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationIndexApiDocument(snapshot) }
  ];
}

