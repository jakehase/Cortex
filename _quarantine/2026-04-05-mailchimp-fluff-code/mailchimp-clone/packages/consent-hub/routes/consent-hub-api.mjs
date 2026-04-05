import { buildConsentHubSnapshot, createConsentHubApiDocument } from '../service-consent-hub.mjs';

export function createConsentHubApiRoutes(basePath = '/api/consent-hub') {
  const snapshot = buildConsentHubSnapshot();
  return [
    { id: 'consent-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-hub.api.document', method: 'GET', path: basePath + '/document', document: createConsentHubApiDocument(snapshot) }
  ];
}

