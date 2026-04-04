import { buildLoyaltyCockpitSnapshot, createLoyaltyCockpitApiDocument } from '../service-loyalty-cockpit.mjs';

export function createLoyaltyCockpitApiRoutes(basePath = '/api/loyalty-cockpit') {
  const snapshot = buildLoyaltyCockpitSnapshot();
  return [
    { id: 'loyalty-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyCockpitApiDocument(snapshot) }
  ];
}

