import { buildExperimentationStudioSnapshot, createExperimentationStudioApiDocument } from '../service-experimentation-studio.mjs';

export function createExperimentationStudioApiRoutes(basePath = '/api/experimentation-studio') {
  const snapshot = buildExperimentationStudioSnapshot();
  return [
    { id: 'experimentation-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-studio.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationStudioApiDocument(snapshot) }
  ];
}

