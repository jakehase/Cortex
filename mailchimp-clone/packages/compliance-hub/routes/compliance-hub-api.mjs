import { buildComplianceHubSnapshot, createComplianceHubApiDocument } from '../service-compliance-hub.mjs';

export function createComplianceHubApiRoutes(basePath = '/api/compliance-hub') {
  const snapshot = buildComplianceHubSnapshot();
  return [
    { id: 'compliance-hub.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-hub.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-hub.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-hub.api.document', method: 'GET', path: basePath + '/document', document: createComplianceHubApiDocument(snapshot) }
  ];
}

