import { buildContentAdvisorSnapshot, createContentAdvisorApiDocument } from '../service-content-advisor.mjs';

export function createContentAdvisorApiRoutes(basePath = '/api/content-advisor') {
  const snapshot = buildContentAdvisorSnapshot();
  return [
    { id: 'content-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-advisor.api.document', method: 'GET', path: basePath + '/document', document: createContentAdvisorApiDocument(snapshot) }
  ];
}

