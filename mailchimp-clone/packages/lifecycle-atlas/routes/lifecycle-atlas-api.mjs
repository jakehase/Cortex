import { buildLifecycleAtlasSnapshot, createLifecycleAtlasApiDocument } from '../service-lifecycle-atlas.mjs';

export function createLifecycleAtlasApiRoutes(basePath = '/api/lifecycle-atlas') {
  const snapshot = buildLifecycleAtlasSnapshot();
  return [
    { id: 'lifecycle-atlas.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-atlas.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-atlas.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-atlas.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleAtlasApiDocument(snapshot) }
  ];
}

