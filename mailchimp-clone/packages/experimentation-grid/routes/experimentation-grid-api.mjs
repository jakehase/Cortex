import { buildExperimentationGridSnapshot, createExperimentationGridApiDocument } from '../service-experimentation-grid.mjs';

export function createExperimentationGridApiRoutes(basePath = '/api/experimentation-grid') {
  const snapshot = buildExperimentationGridSnapshot();
  return [
    { id: 'experimentation-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-grid.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationGridApiDocument(snapshot) }
  ];
}

