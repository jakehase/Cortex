import { buildLocalizationIndexSnapshot, createLocalizationIndexApiDocument } from '../service-localization-index.mjs';

export function createLocalizationIndexApiRoutes(basePath = '/api/localization-index') {
  const snapshot = buildLocalizationIndexSnapshot();
  return [
    { id: 'localization-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-index.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationIndexApiDocument(snapshot) }
  ];
}

