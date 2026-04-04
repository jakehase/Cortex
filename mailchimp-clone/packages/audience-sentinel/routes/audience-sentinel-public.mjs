import { buildAudienceSentinelSnapshot } from '../service-audience-sentinel.mjs';
import { createAudienceSentinelFixtures } from '../fixtures-audience-sentinel.mjs';

export function createAudienceSentinelPublicRoutes(basePath = '/public/audience-sentinel') {
  const snapshot = buildAudienceSentinelSnapshot();
  const fixtures = createAudienceSentinelFixtures();
  return [
    { id: 'audience-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

