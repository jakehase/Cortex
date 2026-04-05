import { buildCreativeSentinelSnapshot } from '../service-creative-sentinel.mjs';
import { createCreativeSentinelFixtures } from '../fixtures-creative-sentinel.mjs';

export function createCreativeSentinelPublicRoutes(basePath = '/public/creative-sentinel') {
  const snapshot = buildCreativeSentinelSnapshot();
  const fixtures = createCreativeSentinelFixtures();
  return [
    { id: 'creative-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

