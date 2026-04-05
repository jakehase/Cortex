import { buildAcquisitionNotebookSnapshot, createAcquisitionNotebookApiDocument } from '../service-acquisition-notebook.mjs';

export function createAcquisitionNotebookApiRoutes(basePath = '/api/acquisition-notebook') {
  const snapshot = buildAcquisitionNotebookSnapshot();
  return [
    { id: 'acquisition-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'acquisition-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'acquisition-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'acquisition-notebook.api.document', method: 'GET', path: basePath + '/document', document: createAcquisitionNotebookApiDocument(snapshot) }
  ];
}

