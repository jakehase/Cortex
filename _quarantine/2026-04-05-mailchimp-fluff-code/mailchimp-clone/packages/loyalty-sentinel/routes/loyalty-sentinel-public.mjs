import { buildLoyaltySentinelSnapshot } from '../service-loyalty-sentinel.mjs';
import { createLoyaltySentinelFixtures } from '../fixtures-loyalty-sentinel.mjs';

export function createLoyaltySentinelPublicRoutes(basePath = '/public/loyalty-sentinel') {
  const snapshot = buildLoyaltySentinelSnapshot();
  const fixtures = createLoyaltySentinelFixtures();
  return [
    { id: 'loyalty-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'loyalty-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'loyalty-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

