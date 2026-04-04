import { buildCollaborationCockpitSnapshot, createCollaborationCockpitApiDocument } from '../service-collaboration-cockpit.mjs';

export function createCollaborationCockpitApiRoutes(basePath = '/api/collaboration-cockpit') {
  const snapshot = buildCollaborationCockpitSnapshot();
  return [
    { id: 'collaboration-cockpit.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'collaboration-cockpit.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'collaboration-cockpit.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'collaboration-cockpit.api.document', method: 'GET', path: basePath + '/document', document: createCollaborationCockpitApiDocument(snapshot) }
  ];
}

