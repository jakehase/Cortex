import { buildCollaborationScorecardSnapshot, createCollaborationScorecardApiDocument } from '../service-collaboration-scorecard.mjs';

export function createCollaborationScorecardApiRoutes(basePath = '/api/collaboration-scorecard') {
  const snapshot = buildCollaborationScorecardSnapshot();
  return [
    { id: 'collaboration-scorecard.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-scorecard.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-scorecard.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-scorecard.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationScorecardApiDocument(snapshot) }
  ];
}

