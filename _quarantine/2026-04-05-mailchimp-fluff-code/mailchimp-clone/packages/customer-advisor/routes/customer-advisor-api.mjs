import { buildCustomerAdvisorSnapshot, createCustomerAdvisorApiDocument } from '../service-customer-advisor.mjs';

export function createCustomerAdvisorApiRoutes(basePath = '/api/customer-advisor') {
  const snapshot = buildCustomerAdvisorSnapshot();
  return [
    { id: 'customer-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'customer-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'customer-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'customer-advisor.api.document', method: 'GET', path: basePath + '/document', document: createCustomerAdvisorApiDocument(snapshot) }
  ];
}

