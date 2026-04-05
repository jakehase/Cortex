import { buildBillingSentinelSnapshot } from '../service-billing-sentinel.mjs';
import { createBillingSentinelFixtures } from '../fixtures-billing-sentinel.mjs';

export function createBillingSentinelPublicRoutes(basePath = '/public/billing-sentinel') {
  const snapshot = buildBillingSentinelSnapshot();
  const fixtures = createBillingSentinelFixtures();
  return [
    { id: 'billing-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

