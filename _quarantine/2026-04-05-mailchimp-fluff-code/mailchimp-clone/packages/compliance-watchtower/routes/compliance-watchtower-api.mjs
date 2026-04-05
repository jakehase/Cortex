import { buildComplianceWatchtowerSnapshot, createComplianceWatchtowerApiDocument } from '../service-compliance-watchtower.mjs';

export function createComplianceWatchtowerApiRoutes(basePath = '/api/compliance-watchtower') {
  const snapshot = buildComplianceWatchtowerSnapshot();
  return [
    { id: 'compliance-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createComplianceWatchtowerApiDocument(snapshot) }
  ];
}

