import { buildLocalizationAtlasSnapshot, createLocalizationAtlasApiDocument } from '../service-localization-atlas.mjs';

export function createLocalizationAtlasApiRoutes(basePath = '/api/localization-atlas') {
  const snapshot = buildLocalizationAtlasSnapshot();
  return [
    { id: 'localization-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-atlas.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationAtlasApiDocument(snapshot) }
  ];
}

