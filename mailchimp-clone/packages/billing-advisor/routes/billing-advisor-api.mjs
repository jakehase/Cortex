import { buildBillingAdvisorSnapshot, createBillingAdvisorApiDocument } from '../service-billing-advisor.mjs';

export function createBillingAdvisorApiRoutes(basePath = '/api/billing-advisor') {
  const snapshot = buildBillingAdvisorSnapshot();
  return [
    { id: 'billing-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'billing-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'billing-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'billing-advisor.api.document', method: 'GET', path: basePath + '/document', document: createBillingAdvisorApiDocument(snapshot) }
  ];
}

