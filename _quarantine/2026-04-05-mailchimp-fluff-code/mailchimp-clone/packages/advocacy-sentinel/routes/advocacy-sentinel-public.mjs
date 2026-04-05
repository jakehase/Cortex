import { buildAdvocacySentinelSnapshot } from '../service-advocacy-sentinel.mjs';
import { createAdvocacySentinelFixtures } from '../fixtures-advocacy-sentinel.mjs';

export function createAdvocacySentinelPublicRoutes(basePath = '/public/advocacy-sentinel') {
  const snapshot = buildAdvocacySentinelSnapshot();
  const fixtures = createAdvocacySentinelFixtures();
  return [
    { id: 'advocacy-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'advocacy-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'advocacy-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

