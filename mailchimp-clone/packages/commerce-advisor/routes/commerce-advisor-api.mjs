import { buildCommerceAdvisorSnapshot, createCommerceAdvisorApiDocument } from '../service-commerce-advisor.mjs';

export function createCommerceAdvisorApiRoutes(basePath = '/api/commerce-advisor') {
  const snapshot = buildCommerceAdvisorSnapshot();
  return [
    { id: 'commerce-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-advisor.api.document', method: 'GET', path: basePath + '/document', document: createCommerceAdvisorApiDocument(snapshot) }
  ];
}

