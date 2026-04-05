import { buildCollaborationSentinelSnapshot, createCollaborationSentinelApiDocument } from '../service-collaboration-sentinel.mjs';

export function createCollaborationSentinelApiRoutes(basePath = '/api/collaboration-sentinel') {
  const snapshot = buildCollaborationSentinelSnapshot();
  return [
    { id: 'collaboration-sentinel.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-sentinel.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-sentinel.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-sentinel.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationSentinelApiDocument(snapshot) }
  ];
}

