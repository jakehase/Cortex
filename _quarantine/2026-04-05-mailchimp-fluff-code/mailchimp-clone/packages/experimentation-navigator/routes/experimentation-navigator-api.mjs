import { buildExperimentationNavigatorSnapshot, createExperimentationNavigatorApiDocument } from '../service-experimentation-navigator.mjs';

export function createExperimentationNavigatorApiRoutes(basePath = '/api/experimentation-navigator') {
  const snapshot = buildExperimentationNavigatorSnapshot();
  return [
    { id: 'experimentation-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-navigator.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationNavigatorApiDocument(snapshot) }
  ];
}

