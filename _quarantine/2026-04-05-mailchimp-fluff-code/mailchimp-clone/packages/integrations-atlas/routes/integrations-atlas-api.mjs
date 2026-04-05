import { buildIntegrationsAtlasSnapshot, createIntegrationsAtlasApiDocument } from '../service-integrations-atlas.mjs';

export function createIntegrationsAtlasApiRoutes(basePath = '/api/integrations-atlas') {
  const snapshot = buildIntegrationsAtlasSnapshot();
  return [
    { id: 'integrations-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-atlas.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsAtlasApiDocument(snapshot) }
  ];
}

