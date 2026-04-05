import { buildExperimentationFoundrySnapshot, createExperimentationFoundryApiDocument } from '../service-experimentation-foundry.mjs';

export function createExperimentationFoundryApiRoutes(basePath = '/api/experimentation-foundry') {
  const snapshot = buildExperimentationFoundrySnapshot();
  return [
    { id: 'experimentation-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-foundry.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationFoundryApiDocument(snapshot) }
  ];
}

