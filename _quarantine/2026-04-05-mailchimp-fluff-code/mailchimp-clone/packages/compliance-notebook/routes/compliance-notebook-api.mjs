import { buildComplianceNotebookSnapshot, createComplianceNotebookApiDocument } from '../service-compliance-notebook.mjs';

export function createComplianceNotebookApiRoutes(basePath = '/api/compliance-notebook') {
  const snapshot = buildComplianceNotebookSnapshot();
  return [
    { id: 'compliance-notebook.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-notebook.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-notebook.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-notebook.api.document', method: 'GET', path: basePath + '/document', document: createComplianceNotebookApiDocument(snapshot) }
  ];
}

