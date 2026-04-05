import { buildAttributionConsoleSnapshot, createAttributionConsoleApiDocument } from '../service-attribution-console.mjs';

export function createAttributionConsoleApiRoutes(basePath = '/api/attribution-console') {
  const snapshot = buildAttributionConsoleSnapshot();
  return [
    { id: 'attribution-console.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'attribution-console.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'attribution-console.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'attribution-console.api.document', method: 'GET', path: basePath + '/document', document: createAttributionConsoleApiDocument(snapshot) }
  ];
}

