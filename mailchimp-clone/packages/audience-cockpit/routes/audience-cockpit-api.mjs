import { buildAudienceCockpitSnapshot, createAudienceCockpitApiDocument } from '../service-audience-cockpit.mjs';

export function createAudienceCockpitApiRoutes(basePath = '/api/audience-cockpit') {
  const snapshot = buildAudienceCockpitSnapshot();
  return [
    { id: 'audience-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createAudienceCockpitApiDocument(snapshot) }
  ];
}

