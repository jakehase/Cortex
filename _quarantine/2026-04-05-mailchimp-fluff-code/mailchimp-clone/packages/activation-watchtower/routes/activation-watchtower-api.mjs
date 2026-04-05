import { buildActivationWatchtowerSnapshot, createActivationWatchtowerApiDocument } from '../service-activation-watchtower.mjs';

export function createActivationWatchtowerApiRoutes(basePath = '/api/activation-watchtower') {
  const snapshot = buildActivationWatchtowerSnapshot();
  return [
    { id: 'activation-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createActivationWatchtowerApiDocument(snapshot) }
  ];
}

