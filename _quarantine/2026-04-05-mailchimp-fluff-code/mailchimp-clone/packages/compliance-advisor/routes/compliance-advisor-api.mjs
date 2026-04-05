import { buildComplianceAdvisorSnapshot, createComplianceAdvisorApiDocument } from '../service-compliance-advisor.mjs';

export function createComplianceAdvisorApiRoutes(basePath = '/api/compliance-advisor') {
  const snapshot = buildComplianceAdvisorSnapshot();
  return [
    { id: 'compliance-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-advisor.api.document', method: 'GET', path: basePath + '/document', document: createComplianceAdvisorApiDocument(snapshot) }
  ];
}

