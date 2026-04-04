import { buildConsentStudioSnapshot, createConsentStudioApiDocument } from '../service-consent-studio.mjs';

export function createConsentStudioApiRoutes(basePath = '/api/consent-studio') {
  const snapshot = buildConsentStudioSnapshot();
  return [
    { id: 'consent-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-studio.api.document', method: 'GET', path: basePath + '/document', document: createConsentStudioApiDocument(snapshot) }
  ];
}

