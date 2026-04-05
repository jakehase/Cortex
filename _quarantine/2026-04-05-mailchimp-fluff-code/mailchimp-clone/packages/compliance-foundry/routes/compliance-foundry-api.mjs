import { buildComplianceFoundrySnapshot, createComplianceFoundryApiDocument } from '../service-compliance-foundry.mjs';

export function createComplianceFoundryApiRoutes(basePath = '/api/compliance-foundry') {
  const snapshot = buildComplianceFoundrySnapshot();
  return [
    { id: 'compliance-foundry.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-foundry.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-foundry.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-foundry.api.document', method: 'GET', path: basePath + '/document', document: createComplianceFoundryApiDocument(snapshot) }
  ];
}

