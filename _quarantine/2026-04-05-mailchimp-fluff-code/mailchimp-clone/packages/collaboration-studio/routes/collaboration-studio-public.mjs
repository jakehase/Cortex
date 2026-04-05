import { buildCollaborationStudioSnapshot } from '../service-collaboration-studio.mjs';
import { createCollaborationStudioFixtures } from '../fixtures-collaboration-studio.mjs';

export function createCollaborationStudioPublicRoutes(basePath = '/public/collaboration-studio') {
  const snapshot = buildCollaborationStudioSnapshot();
  const fixtures = createCollaborationStudioFixtures();
  return [
    { id: 'collaboration-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

