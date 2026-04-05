import { buildCommerceSentinelSnapshot } from '../service-commerce-sentinel.mjs';
import { createCommerceSentinelFixtures } from '../fixtures-commerce-sentinel.mjs';

export function createCommerceSentinelPublicRoutes(basePath = '/public/commerce-sentinel') {
  const snapshot = buildCommerceSentinelSnapshot();
  const fixtures = createCommerceSentinelFixtures();
  return [
    { id: 'commerce-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

