import { buildLocalizationCockpitSnapshot, createLocalizationCockpitApiDocument } from '../service-localization-cockpit.mjs';

export function createLocalizationCockpitApiRoutes(basePath = '/api/localization-cockpit') {
  const snapshot = buildLocalizationCockpitSnapshot();
  return [
    { id: 'localization-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'localization-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'localization-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'localization-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createLocalizationCockpitApiDocument(snapshot) }
  ];
}

