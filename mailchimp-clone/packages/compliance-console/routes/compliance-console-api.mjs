import { buildComplianceConsoleSnapshot, createComplianceConsoleApiDocument } from '../service-compliance-console.mjs';

export function createComplianceConsoleApiRoutes(basePath = '/api/compliance-console') {
  const snapshot = buildComplianceConsoleSnapshot();
  return [
    { id: 'compliance-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-console.api.document', method: 'GET', path: basePath + '/document', document: createComplianceConsoleApiDocument(snapshot) }
  ];
}

