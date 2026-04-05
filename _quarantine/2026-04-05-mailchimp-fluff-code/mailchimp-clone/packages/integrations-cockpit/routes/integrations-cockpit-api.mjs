import { buildIntegrationsCockpitSnapshot, createIntegrationsCockpitApiDocument } from '../service-integrations-cockpit.mjs';

export function createIntegrationsCockpitApiRoutes(basePath = '/api/integrations-cockpit') {
  const snapshot = buildIntegrationsCockpitSnapshot();
  return [
    { id: 'integrations-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'integrations-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'integrations-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'integrations-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createIntegrationsCockpitApiDocument(snapshot) }
  ];
}

