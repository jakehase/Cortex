import { buildLoyaltyAdvisorSnapshot, createLoyaltyAdvisorApiDocument } from '../service-loyalty-advisor.mjs';

export function createLoyaltyAdvisorApiRoutes(basePath = '/api/loyalty-advisor') {
  const snapshot = buildLoyaltyAdvisorSnapshot();
  return [
    { id: 'loyalty-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-advisor.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyAdvisorApiDocument(snapshot) }
  ];
}

