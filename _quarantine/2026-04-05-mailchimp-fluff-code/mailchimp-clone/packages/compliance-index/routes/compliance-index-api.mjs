import { buildComplianceIndexSnapshot, createComplianceIndexApiDocument } from '../service-compliance-index.mjs';

export function createComplianceIndexApiRoutes(basePath = '/api/compliance-index') {
  const snapshot = buildComplianceIndexSnapshot();
  return [
    { id: 'compliance-index.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-index.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-index.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-index.api.document', method: 'GET', path: basePath + '/document', document: createComplianceIndexApiDocument(snapshot) }
  ];
}

