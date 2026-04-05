import { buildComplianceAtlasSnapshot, createComplianceAtlasApiDocument } from '../service-compliance-atlas.mjs';

export function createComplianceAtlasApiRoutes(basePath = '/api/compliance-atlas') {
  const snapshot = buildComplianceAtlasSnapshot();
  return [
    { id: 'compliance-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'compliance-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'compliance-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'compliance-atlas.api.document', method: 'GET', path: basePath + '/document', document: createComplianceAtlasApiDocument(snapshot) }
  ];
}

