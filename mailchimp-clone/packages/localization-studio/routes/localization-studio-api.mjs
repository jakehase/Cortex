import { buildLocalizationStudioSnapshot, createLocalizationStudioApiDocument } from '../service-localization-studio.mjs';

export function createLocalizationStudioApiRoutes(basePath = '/api/localization-studio') {
  const snapshot = buildLocalizationStudioSnapshot();
  return [
    { id: 'localization-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-studio.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationStudioApiDocument(snapshot) }
  ];
}
