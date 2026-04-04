import { buildCollaborationHubSnapshot } from '../service-collaboration-hub.mjs';
import { createCollaborationHubFixtures } from '../fixtures-collaboration-hub.mjs';

export function createCollaborationHubPublicRoutes(basePath = '/public/collaboration-hub') {
  const snapshot = buildCollaborationHubSnapshot();
  const fixtures = createCollaborationHubFixtures();
  return [
    { id: 'collaboration-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

