import { buildTemplateMarketplaceSnapshot, createTemplateMarketplaceApiDocument } from '../service-template-marketplace.mjs';

export function createTemplateMarketplaceApiRoutes(basePath = '/api/template-marketplace') {
  const snapshot = buildTemplateMarketplaceSnapshot();
  return [
    { id: 'template-marketplace.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'template-marketplace.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'template-marketplace.api.document', method: 'GET', path: basePath + '/document', document: createTemplateMarketplaceApiDocument(snapshot) }
  ];
}
