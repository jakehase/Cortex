import { buildLifecycleWatchtowerSnapshot, createLifecycleWatchtowerApiDocument } from '../service-lifecycle-watchtower.mjs';

export function createLifecycleWatchtowerApiRoutes(basePath = '/api/lifecycle-watchtower') {
  const snapshot = buildLifecycleWatchtowerSnapshot();
  return [
    { id: 'lifecycle-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'lifecycle-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'lifecycle-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'lifecycle-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createLifecycleWatchtowerApiDocument(snapshot) }
  ];
}

