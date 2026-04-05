import { buildCollaborationExchangeSnapshot, createCollaborationExchangeApiDocument } from '../service-collaboration-exchange.mjs';

export function createCollaborationExchangeApiRoutes(basePath = '/api/collaboration-exchange') {
  const snapshot = buildCollaborationExchangeSnapshot();
  return [
    { id: 'collaboration-exchange.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-exchange.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-exchange.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-exchange.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationExchangeApiDocument(snapshot) }
  ];
}

