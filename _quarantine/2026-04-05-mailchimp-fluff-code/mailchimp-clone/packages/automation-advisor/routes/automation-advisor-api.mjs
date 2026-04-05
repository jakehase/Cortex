import { buildAutomationAdvisorSnapshot, createAutomationAdvisorApiDocument } from '../service-automation-advisor.mjs';

export function createAutomationAdvisorApiRoutes(basePath = '/api/automation-advisor') {
  const snapshot = buildAutomationAdvisorSnapshot();
  return [
    { id: 'automation-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-advisor.api.document', method: 'GET', path: basePath + '/document', document: createAutomationAdvisorApiDocument(snapshot) }
  ];
}

