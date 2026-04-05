import { buildLocalizationNotebookSnapshot, createLocalizationNotebookApiDocument } from '../service-localization-notebook.mjs';

export function createLocalizationNotebookApiRoutes(basePath = '/api/localization-notebook') {
  const snapshot = buildLocalizationNotebookSnapshot();
  return [
    { id: 'localization-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-notebook.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationNotebookApiDocument(snapshot) }
  ];
}

