import { buildAudienceNotebookSnapshot, createAudienceNotebookApiDocument } from '../service-audience-notebook.mjs';

export function createAudienceNotebookApiRoutes(basePath = '/api/audience-notebook') {
  const snapshot = buildAudienceNotebookSnapshot();
  return [
    { id: 'audience-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-notebook.api.document', method: 'GET', path: basePath + '/document', document: createAudienceNotebookApiDocument(snapshot) }
  ];
}

