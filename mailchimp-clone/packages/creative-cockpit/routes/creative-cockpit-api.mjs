import { buildCreativeCockpitSnapshot, createCreativeCockpitApiDocument } from '../service-creative-cockpit.mjs';

export function createCreativeCockpitApiRoutes(basePath = '/api/creative-cockpit') {
  const snapshot = buildCreativeCockpitSnapshot();
  return [
    { id: 'creative-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'creative-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'creative-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'creative-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createCreativeCockpitApiDocument(snapshot) }
  ];
}

