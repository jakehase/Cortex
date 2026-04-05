import { buildConsentConsoleSnapshot, createConsentConsoleApiDocument } from '../service-consent-console.mjs';

export function createConsentConsoleApiRoutes(basePath = '/api/consent-console') {
  const snapshot = buildConsentConsoleSnapshot();
  return [
    { id: 'consent-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-console.api.document', method: 'GET', path: basePath + '/document', document: createConsentConsoleApiDocument(snapshot) }
  ];
}

