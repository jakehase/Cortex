import { buildAdvocacyCockpitSnapshot, createAdvocacyCockpitApiDocument } from '../service-advocacy-cockpit.mjs';

export function createAdvocacyCockpitApiRoutes(basePath = '/api/advocacy-cockpit') {
  const snapshot = buildAdvocacyCockpitSnapshot();
  return [
    { id: 'advocacy-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'advocacy-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'advocacy-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'advocacy-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createAdvocacyCockpitApiDocument(snapshot) }
  ];
}

