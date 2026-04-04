import { buildEcommerceSentinelSnapshot } from '../service-ecommerce-sentinel.mjs';
import { createEcommerceSentinelFixtures } from '../fixtures-ecommerce-sentinel.mjs';

export function createEcommerceSentinelPublicRoutes(basePath = '/public/ecommerce-sentinel') {
  const snapshot = buildEcommerceSentinelSnapshot();
  const fixtures = createEcommerceSentinelFixtures();
  return [
    { id: 'ecommerce-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

