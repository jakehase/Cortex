import { buildBillingWorkbenchSnapshot } from '../service-billing-workbench.mjs';
import { createBillingWorkbenchFixtures } from '../fixtures-billing-workbench.mjs';

export function createBillingWorkbenchPublicRoutes(basePath = '/public/billing-workbench') {
  const snapshot = buildBillingWorkbenchSnapshot();
  const fixtures = createBillingWorkbenchFixtures();
  return [
    { id: 'billing-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

