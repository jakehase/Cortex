import { buildLocalizationFoundrySnapshot, createLocalizationFoundryApiDocument } from '../service-localization-foundry.mjs';

export function createLocalizationFoundryApiRoutes(basePath = '/api/localization-foundry') {
  const snapshot = buildLocalizationFoundrySnapshot();
  return [
    { id: 'localization-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-foundry.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationFoundryApiDocument(snapshot) }
  ];
}

