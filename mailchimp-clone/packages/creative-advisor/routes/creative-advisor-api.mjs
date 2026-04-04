import { buildCreativeAdvisorSnapshot, createCreativeAdvisorApiDocument } from '../service-creative-advisor.mjs';

export function createCreativeAdvisorApiRoutes(basePath = '/api/creative-advisor') {
  const snapshot = buildCreativeAdvisorSnapshot();
  return [
    { id: 'creative-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-advisor.api.document', method: 'GET', path: basePath + '/document', document: createCreativeAdvisorApiDocument(snapshot) }
  ];
}

