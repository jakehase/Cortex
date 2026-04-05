import { buildExperimentationConsoleSnapshot, createExperimentationConsoleApiDocument } from '../service-experimentation-console.mjs';

export function createExperimentationConsoleApiRoutes(basePath = '/api/experimentation-console') {
  const snapshot = buildExperimentationConsoleSnapshot();
  return [
    { id: 'experimentation-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-console.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationConsoleApiDocument(snapshot) }
  ];
}

