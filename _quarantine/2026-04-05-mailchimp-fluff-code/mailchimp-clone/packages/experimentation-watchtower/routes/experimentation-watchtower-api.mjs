import { buildExperimentationWatchtowerSnapshot, createExperimentationWatchtowerApiDocument } from '../service-experimentation-watchtower.mjs';

export function createExperimentationWatchtowerApiRoutes(basePath = '/api/experimentation-watchtower') {
  const snapshot = buildExperimentationWatchtowerSnapshot();
  return [
    { id: 'experimentation-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationWatchtowerApiDocument(snapshot) }
  ];
}

