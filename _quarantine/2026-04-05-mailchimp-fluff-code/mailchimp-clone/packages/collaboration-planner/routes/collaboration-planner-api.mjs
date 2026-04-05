import { buildCollaborationPlannerSnapshot, createCollaborationPlannerApiDocument } from '../service-collaboration-planner.mjs';

export function createCollaborationPlannerApiRoutes(basePath = '/api/collaboration-planner') {
  const snapshot = buildCollaborationPlannerSnapshot();
  return [
    { id: 'collaboration-planner.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-planner.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-planner.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-planner.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationPlannerApiDocument(snapshot) }
  ];
}

