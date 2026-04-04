import { buildComplianceGridSnapshot, createComplianceGridApiDocument } from '../service-compliance-grid.mjs';

export function createComplianceGridApiRoutes(basePath = '/api/compliance-grid') {
  const snapshot = buildComplianceGridSnapshot();
  return [
    { id: 'compliance-grid.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-grid.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-grid.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-grid.api.document', method: 'GET', path: basePath + '/document', document: createComplianceGridApiDocument(snapshot) }
  ];
}

