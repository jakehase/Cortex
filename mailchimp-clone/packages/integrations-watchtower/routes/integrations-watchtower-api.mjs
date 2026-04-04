import { buildIntegrationsWatchtowerSnapshot, createIntegrationsWatchtowerApiDocument } from '../service-integrations-watchtower.mjs';

export function createIntegrationsWatchtowerApiRoutes(basePath = '/api/integrations-watchtower') {
  const snapshot = buildIntegrationsWatchtowerSnapshot();
  return [
    { id: 'integrations-watchtower.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-watchtower.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-watchtower.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-watchtower.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsWatchtowerApiDocument(snapshot) }
  ];
}

