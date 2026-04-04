import { buildContentCockpitSnapshot, createContentCockpitApiDocument } from '../service-content-cockpit.mjs';

export function createContentCockpitApiRoutes(basePath = '/api/content-cockpit') {
  const snapshot = buildContentCockpitSnapshot();
  return [
    { id: 'content-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'content-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'content-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'content-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createContentCockpitApiDocument(snapshot) }
  ];
}

