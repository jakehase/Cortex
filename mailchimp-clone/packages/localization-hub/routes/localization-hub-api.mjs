import { buildLocalizationHubSnapshot, createLocalizationHubApiDocument } from '../service-localization-hub.mjs';

export function createLocalizationHubApiRoutes(basePath = '/api/localization-hub') {
  const snapshot = buildLocalizationHubSnapshot();
  return [
    { id: 'localization-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-hub.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationHubApiDocument(snapshot) }
  ];
}

