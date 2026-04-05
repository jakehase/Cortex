import { buildConsentFoundrySnapshot, createConsentFoundryApiDocument } from '../service-consent-foundry.mjs';

export function createConsentFoundryApiRoutes(basePath = '/api/consent-foundry') {
  const snapshot = buildConsentFoundrySnapshot();
  return [
    { id: 'consent-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-foundry.api.document', method: 'GET', path: basePath + '/document', document: createConsentFoundryApiDocument(snapshot) }
  ];
}

