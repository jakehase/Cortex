import { buildLocalizationDossierSnapshot, createLocalizationDossierApiDocument } from '../service-localization-dossier.mjs';

export function createLocalizationDossierApiRoutes(basePath = '/api/localization-dossier') {
  const snapshot = buildLocalizationDossierSnapshot();
  return [
    { id: 'localization-dossier.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-dossier.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-dossier.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-dossier.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationDossierApiDocument(snapshot) }
  ];
}

