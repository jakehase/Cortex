import { buildAudienceAdvisorSnapshot, createAudienceAdvisorApiDocument } from '../service-audience-advisor.mjs';

export function createAudienceAdvisorApiRoutes(basePath = '/api/audience-advisor') {
  const snapshot = buildAudienceAdvisorSnapshot();
  return [
    { id: 'audience-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-advisor.api.document', method: 'GET', path: basePath + '/document', document: createAudienceAdvisorApiDocument(snapshot) }
  ];
}

