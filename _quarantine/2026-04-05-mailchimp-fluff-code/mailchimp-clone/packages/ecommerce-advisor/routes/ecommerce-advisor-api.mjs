import { buildEcommerceAdvisorSnapshot, createEcommerceAdvisorApiDocument } from '../service-ecommerce-advisor.mjs';

export function createEcommerceAdvisorApiRoutes(basePath = '/api/ecommerce-advisor') {
  const snapshot = buildEcommerceAdvisorSnapshot();
  return [
    { id: 'ecommerce-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'ecommerce-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'ecommerce-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'ecommerce-advisor.api.document', method: 'GET', path: basePath + '/document', document: createEcommerceAdvisorApiDocument(snapshot) }
  ];
}

