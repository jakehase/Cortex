import { buildExperimentationNotebookSnapshot, createExperimentationNotebookApiDocument } from '../service-experimentation-notebook.mjs';

export function createExperimentationNotebookApiRoutes(basePath = '/api/experimentation-notebook') {
  const snapshot = buildExperimentationNotebookSnapshot();
  return [
    { id: 'experimentation-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'experimentation-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'experimentation-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'experimentation-notebook.api.document', method: 'GET', path: basePath + '/document', document: createExperimentationNotebookApiDocument(snapshot) }
  ];
}

