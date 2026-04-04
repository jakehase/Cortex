import { buildCommerceWorkbenchSnapshot, createCommerceWorkbenchApiDocument } from '../service-commerce-workbench.mjs';

export function createCommerceWorkbenchApiRoutes(basePath = '/api/commerce-workbench') {
  const snapshot = buildCommerceWorkbenchSnapshot();
  return [
    { id: 'commerce-workbench.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'commerce-workbench.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'commerce-workbench.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'commerce-workbench.api.document', method: 'GET', path: basePath + '/document', document: createCommerceWorkbenchApiDocument(snapshot) }
  ];
}

