import { buildAdvocacyAdvisorSnapshot, createAdvocacyAdvisorApiDocument } from '../service-advocacy-advisor.mjs';

export function createAdvocacyAdvisorApiRoutes(basePath = '/api/advocacy-advisor') {
  const snapshot = buildAdvocacyAdvisorSnapshot();
  return [
    { id: 'advocacy-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-advisor.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyAdvisorApiDocument(snapshot) }
  ];
}

