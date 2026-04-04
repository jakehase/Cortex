import { buildIntegrationsAdvisorSnapshot, createIntegrationsAdvisorApiDocument } from '../service-integrations-advisor.mjs';

export function createIntegrationsAdvisorApiRoutes(basePath = '/api/integrations-advisor') {
  const snapshot = buildIntegrationsAdvisorSnapshot();
  return [
    { id: 'integrations-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-advisor.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsAdvisorApiDocument(snapshot) }
  ];
}

