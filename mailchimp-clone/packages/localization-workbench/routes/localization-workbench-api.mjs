import { buildLocalizationWorkbenchSnapshot, createLocalizationWorkbenchApiDocument } from '../service-localization-workbench.mjs';

export function createLocalizationWorkbenchApiRoutes(basePath = '/api/localization-workbench') {
  const snapshot = buildLocalizationWorkbenchSnapshot();
  return [
    { id: 'localization-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-workbench.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationWorkbenchApiDocument(snapshot) }
  ];
}

