import { buildAutomationAtlasSnapshot, createAutomationAtlasApiDocument } from '../service-automation-atlas.mjs';

export function createAutomationAtlasApiRoutes(basePath = '/api/automation-atlas') {
  const snapshot = buildAutomationAtlasSnapshot();
  return [
    { id: 'automation-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'automation-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'automation-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'automation-atlas.api.document', method: 'GET', path: basePath + '/document', document: createAutomationAtlasApiDocument(snapshot) }
  ];
}

