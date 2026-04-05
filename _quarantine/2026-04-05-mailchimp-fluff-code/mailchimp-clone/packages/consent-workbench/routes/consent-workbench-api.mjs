import { buildConsentWorkbenchSnapshot, createConsentWorkbenchApiDocument } from '../service-consent-workbench.mjs';

export function createConsentWorkbenchApiRoutes(basePath = '/api/consent-workbench') {
  const snapshot = buildConsentWorkbenchSnapshot();
  return [
    { id: 'consent-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-workbench.api.document', method: 'GET', path: basePath + '/document', document: createConsentWorkbenchApiDocument(snapshot) }
  ];
}

