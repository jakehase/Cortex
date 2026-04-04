import { buildPartnerCockpitSnapshot, createPartnerCockpitApiDocument } from '../service-partner-cockpit.mjs';

export function createPartnerCockpitApiRoutes(basePath = '/api/partner-cockpit') {
  const snapshot = buildPartnerCockpitSnapshot();
  return [
    { id: 'partner-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'partner-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'partner-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'partner-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createPartnerCockpitApiDocument(snapshot) }
  ];
}

