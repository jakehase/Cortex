import { buildDataAdvisorSnapshot, createDataAdvisorApiDocument } from '../service-data-advisor.mjs';

export function createDataAdvisorApiRoutes(basePath = '/api/data-advisor') {
  const snapshot = buildDataAdvisorSnapshot();
  return [
    { id: 'data-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'data-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'data-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'data-advisor.api.document', method: 'GET', path: basePath + '/document', document: createDataAdvisorApiDocument(snapshot) }
  ];
}

