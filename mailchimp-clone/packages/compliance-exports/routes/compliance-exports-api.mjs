import { buildComplianceExportsSnapshot, createComplianceExportsApiDocument } from '../service-compliance-exports.mjs';

export function createComplianceExportsApiRoutes(basePath = '/api/compliance-exports') {
  const snapshot = buildComplianceExportsSnapshot();
  return [
    { id: 'compliance-exports.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-exports.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-exports.api.document', method: 'GET', path: basePath + '/document', document: createComplianceExportsApiDocument(snapshot) }
  ];
}
