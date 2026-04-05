import { buildLifecycleAdvisorSnapshot, createLifecycleAdvisorApiDocument } from '../service-lifecycle-advisor.mjs';

export function createLifecycleAdvisorApiRoutes(basePath = '/api/lifecycle-advisor') {
  const snapshot = buildLifecycleAdvisorSnapshot();
  return [
    { id: 'lifecycle-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-advisor.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleAdvisorApiDocument(snapshot) }
  ];
}

