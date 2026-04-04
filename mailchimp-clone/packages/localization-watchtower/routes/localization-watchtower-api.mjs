import { buildLocalizationWatchtowerSnapshot, createLocalizationWatchtowerApiDocument } from '../service-localization-watchtower.mjs';

export function createLocalizationWatchtowerApiRoutes(basePath = '/api/localization-watchtower') {
  const snapshot = buildLocalizationWatchtowerSnapshot();
  return [
    { id: 'localization-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationWatchtowerApiDocument(snapshot) }
  ];
}

