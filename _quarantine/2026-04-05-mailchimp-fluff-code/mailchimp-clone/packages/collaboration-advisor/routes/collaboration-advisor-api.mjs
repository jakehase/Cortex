import { buildCollaborationAdvisorSnapshot, createCollaborationAdvisorApiDocument } from '../service-collaboration-advisor.mjs';

export function createCollaborationAdvisorApiRoutes(basePath = '/api/collaboration-advisor') {
  const snapshot = buildCollaborationAdvisorSnapshot();
  return [
    { id: 'collaboration-advisor.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-advisor.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-advisor.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-advisor.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationAdvisorApiDocument(snapshot) }
  ];
}

