import { buildPartnerAdvisorSnapshot, createPartnerAdvisorApiDocument } from '../service-partner-advisor.mjs';

export function createPartnerAdvisorApiRoutes(basePath = '/api/partner-advisor') {
  const snapshot = buildPartnerAdvisorSnapshot();
  return [
    { id: 'partner-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'partner-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'partner-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'partner-advisor.api.document', method: 'GET', path: basePath + '/document', document: createPartnerAdvisorApiDocument(snapshot) }
  ];
}

