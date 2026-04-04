import { buildComplianceNavigatorSnapshot, createComplianceNavigatorApiDocument } from '../service-compliance-navigator.mjs';

export function createComplianceNavigatorApiRoutes(basePath = '/api/compliance-navigator') {
  const snapshot = buildComplianceNavigatorSnapshot();
  return [
    { id: 'compliance-navigator.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-navigator.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-navigator.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-navigator.api.document', method: 'GET', path: basePath + '/document', document: createComplianceNavigatorApiDocument(snapshot) }
  ];
}

