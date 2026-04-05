import { buildComplianceWorkbenchSnapshot, createComplianceWorkbenchApiDocument } from '../service-compliance-workbench.mjs';

export function createComplianceWorkbenchApiRoutes(basePath = '/api/compliance-workbench') {
  const snapshot = buildComplianceWorkbenchSnapshot();
  return [
    { id: 'compliance-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-workbench.api.document', method: 'GET', path: basePath + '/document', document: createComplianceWorkbenchApiDocument(snapshot) }
  ];
}

