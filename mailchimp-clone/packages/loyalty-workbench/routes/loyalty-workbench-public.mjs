import { buildLoyaltyWorkbenchSnapshot } from '../service-loyalty-workbench.mjs';
import { createLoyaltyWorkbenchFixtures } from '../fixtures-loyalty-workbench.mjs';

export function createLoyaltyWorkbenchPublicRoutes(basePath = '/public/loyalty-workbench') {
  const snapshot = buildLoyaltyWorkbenchSnapshot();
  const fixtures = createLoyaltyWorkbenchFixtures();
  return [
    { id: 'loyalty-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

