import { buildLocalizationNavigatorSnapshot, createLocalizationNavigatorApiDocument } from '../service-localization-navigator.mjs';

export function createLocalizationNavigatorApiRoutes(basePath = '/api/localization-navigator') {
  const snapshot = buildLocalizationNavigatorSnapshot();
  return [
    { id: 'localization-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-navigator.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationNavigatorApiDocument(snapshot) }
  ];
}

