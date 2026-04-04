import { buildCollaborationFoundrySnapshot } from '../service-collaboration-foundry.mjs';
import { createCollaborationFoundryFixtures } from '../fixtures-collaboration-foundry.mjs';

export function createCollaborationFoundryPublicRoutes(basePath = '/public/collaboration-foundry') {
  const snapshot = buildCollaborationFoundrySnapshot();
  const fixtures = createCollaborationFoundryFixtures();
  return [
    { id: 'collaboration-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

