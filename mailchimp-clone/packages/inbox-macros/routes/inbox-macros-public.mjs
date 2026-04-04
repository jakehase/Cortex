import { buildInboxMacrosSnapshot } from '../service-inbox-macros.mjs';
import { createInboxMacrosFixtures } from '../fixtures-inbox-macros.mjs';

export function createInboxMacrosPublicRoutes(basePath = '/public/inbox-macros') {
  const snapshot = buildInboxMacrosSnapshot();
  const fixtures = createInboxMacrosFixtures();
  return [
    { id: 'inbox-macros.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'inbox-macros.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'inbox-macros.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
