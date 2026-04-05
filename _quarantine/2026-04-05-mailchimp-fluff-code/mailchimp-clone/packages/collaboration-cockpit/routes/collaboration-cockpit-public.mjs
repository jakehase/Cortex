import { buildCollaborationCockpitSnapshot } from '../service-collaboration-cockpit.mjs';
import { createCollaborationCockpitFixtures } from '../fixtures-collaboration-cockpit.mjs';

export function createCollaborationCockpitPublicRoutes(basePath = '/public/collaboration-cockpit') {
  const snapshot = buildCollaborationCockpitSnapshot();
  const fixtures = createCollaborationCockpitFixtures();
  return [
    { id: 'collaboration-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

