import { buildExperimentationWorkbenchSnapshot, createExperimentationWorkbenchApiDocument } from '../service-experimentation-workbench.mjs';

export function createExperimentationWorkbenchApiRoutes(basePath = '/api/experimentation-workbench') {
  const snapshot = buildExperimentationWorkbenchSnapshot();
  return [
    { id: 'experimentation-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-workbench.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationWorkbenchApiDocument(snapshot) }
  ];
}

