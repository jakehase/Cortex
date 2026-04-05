import { buildConsentCockpitSnapshot, createConsentCockpitApiDocument } from '../service-consent-cockpit.mjs';

export function createConsentCockpitApiRoutes(basePath = '/api/consent-cockpit') {
  const snapshot = buildConsentCockpitSnapshot();
  return [
    { id: 'consent-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createConsentCockpitApiDocument(snapshot) }
  ];
}

