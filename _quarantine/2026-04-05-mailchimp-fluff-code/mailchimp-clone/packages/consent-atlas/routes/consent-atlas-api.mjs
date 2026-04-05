import { buildConsentAtlasSnapshot, createConsentAtlasApiDocument } from '../service-consent-atlas.mjs';

export function createConsentAtlasApiRoutes(basePath = '/api/consent-atlas') {
  const snapshot = buildConsentAtlasSnapshot();
  return [
    { id: 'consent-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-atlas.api.document', method: 'GET', path: basePath + '/document', document: createConsentAtlasApiDocument(snapshot) }
  ];
}

