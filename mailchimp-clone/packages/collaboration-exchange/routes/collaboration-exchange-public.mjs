import { buildCollaborationExchangeSnapshot } from '../service-collaboration-exchange.mjs';
import { createCollaborationExchangeFixtures } from '../fixtures-collaboration-exchange.mjs';

export function createCollaborationExchangePublicRoutes(basePath = '/public/collaboration-exchange') {
  const snapshot = buildCollaborationExchangeSnapshot();
  const fixtures = createCollaborationExchangeFixtures();
  return [
    { id: 'collaboration-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

