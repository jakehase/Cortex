import { buildConsentAdvisorSnapshot, createConsentAdvisorApiDocument } from '../service-consent-advisor.mjs';

export function createConsentAdvisorApiRoutes(basePath = '/api/consent-advisor') {
  const snapshot = buildConsentAdvisorSnapshot();
  return [
    { id: 'consent-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'consent-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'consent-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'consent-advisor.api.document', method: 'GET', path: basePath + '/document', document: createConsentAdvisorApiDocument(snapshot) }
  ];
}

