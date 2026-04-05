import { buildActivationCockpitSnapshot, createActivationCockpitApiDocument } from '../service-activation-cockpit.mjs';

export function createActivationCockpitApiRoutes(basePath = '/api/activation-cockpit') {
  const snapshot = buildActivationCockpitSnapshot();
  return [
    { id: 'activation-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'activation-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'activation-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'activation-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createActivationCockpitApiDocument(snapshot) }
  ];
}

