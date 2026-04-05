import { buildAttributionAdvisorSnapshot, createAttributionAdvisorApiDocument } from '../service-attribution-advisor.mjs';

export function createAttributionAdvisorApiRoutes(basePath = '/api/attribution-advisor') {
  const snapshot = buildAttributionAdvisorSnapshot();
  return [
    { id: 'attribution-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-advisor.api.document', method: 'GET', path: basePath + '/document', document: createAttributionAdvisorApiDocument(snapshot) }
  ];
}

