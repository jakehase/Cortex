import { buildLocalizationConsoleSnapshot, createLocalizationConsoleApiDocument } from '../service-localization-console.mjs';

export function createLocalizationConsoleApiRoutes(basePath = '/api/localization-console') {
  const snapshot = buildLocalizationConsoleSnapshot();
  return [
    { id: 'localization-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-console.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationConsoleApiDocument(snapshot) }
  ];
}

