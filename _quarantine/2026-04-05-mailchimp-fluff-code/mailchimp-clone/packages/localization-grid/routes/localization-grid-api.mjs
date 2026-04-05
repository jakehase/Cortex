import { buildLocalizationGridSnapshot, createLocalizationGridApiDocument } from '../service-localization-grid.mjs';

export function createLocalizationGridApiRoutes(basePath = '/api/localization-grid') {
  const snapshot = buildLocalizationGridSnapshot();
  return [
    { id: 'localization-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-grid.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationGridApiDocument(snapshot) }
  ];
}

