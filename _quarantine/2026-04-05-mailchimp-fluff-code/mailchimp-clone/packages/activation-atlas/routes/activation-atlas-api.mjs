import { buildActivationAtlasSnapshot, createActivationAtlasApiDocument } from '../service-activation-atlas.mjs';

export function createActivationAtlasApiRoutes(basePath = '/api/activation-atlas') {
  const snapshot = buildActivationAtlasSnapshot();
  return [
    { id: 'activation-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-atlas.api.document', method: 'GET', path: basePath + '/document', document: createActivationAtlasApiDocument(snapshot) }
  ];
}

