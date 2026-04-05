import { buildComplianceStudioSnapshot, createComplianceStudioApiDocument } from '../service-compliance-studio.mjs';

export function createComplianceStudioApiRoutes(basePath = '/api/compliance-studio') {
  const snapshot = buildComplianceStudioSnapshot();
  return [
    { id: 'compliance-studio.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-studio.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-studio.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-studio.api.document', method: 'GET', path: basePath + '/document', document: createComplianceStudioApiDocument(snapshot) }
  ];
}

