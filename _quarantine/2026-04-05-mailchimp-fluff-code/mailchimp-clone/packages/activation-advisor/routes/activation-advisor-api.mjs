import { buildActivationAdvisorSnapshot, createActivationAdvisorApiDocument } from '../service-activation-advisor.mjs';

export function createActivationAdvisorApiRoutes(basePath = '/api/activation-advisor') {
  const snapshot = buildActivationAdvisorSnapshot();
  return [
    { id: 'activation-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-advisor.api.document', method: 'GET', path: basePath + '/document', document: createActivationAdvisorApiDocument(snapshot) }
  ];
}

