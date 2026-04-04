import { buildAudienceWorkbenchSnapshot, createAudienceWorkbenchApiDocument } from '../service-audience-workbench.mjs';

export function createAudienceWorkbenchApiRoutes(basePath = '/api/audience-workbench') {
  const snapshot = buildAudienceWorkbenchSnapshot();
  return [
    { id: 'audience-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'audience-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'audience-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'audience-workbench.api.document', method: 'GET', path: basePath + '/document', document: createAudienceWorkbenchApiDocument(snapshot) }
  ];
}

