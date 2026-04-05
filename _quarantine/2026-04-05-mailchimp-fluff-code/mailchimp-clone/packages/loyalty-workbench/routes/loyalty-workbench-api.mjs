import { buildLoyaltyWorkbenchSnapshot, createLoyaltyWorkbenchApiDocument } from '../service-loyalty-workbench.mjs';

export function createLoyaltyWorkbenchApiRoutes(basePath = '/api/loyalty-workbench') {
  const snapshot = buildLoyaltyWorkbenchSnapshot();
  return [
    { id: 'loyalty-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'loyalty-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'loyalty-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'loyalty-workbench.api.document', method: 'GET', path: basePath + '/document', document: createLoyaltyWorkbenchApiDocument(snapshot) }
  ];
}

