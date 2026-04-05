import { buildCollaborationSentinelSnapshot } from '../service-collaboration-sentinel.mjs';
import { createCollaborationSentinelFixtures } from '../fixtures-collaboration-sentinel.mjs';

export function createCollaborationSentinelPublicRoutes(basePath = '/public/collaboration-sentinel') {
  const snapshot = buildCollaborationSentinelSnapshot();
  const fixtures = createCollaborationSentinelFixtures();
  return [
    { id: 'collaboration-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

