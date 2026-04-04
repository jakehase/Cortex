import { buildConsentNotebookSnapshot, createConsentNotebookApiDocument } from '../service-consent-notebook.mjs';

export function createConsentNotebookApiRoutes(basePath = '/api/consent-notebook') {
  const snapshot = buildConsentNotebookSnapshot();
  return [
    { id: 'consent-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-notebook.api.document', method: 'GET', path: basePath + '/document', document: createConsentNotebookApiDocument(snapshot) }
  ];
}

