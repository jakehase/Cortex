import { buildAudienceSyncSnapshot } from '../service-audience-sync.mjs';
import { createAudienceSyncFixtures } from '../fixtures-audience-sync.mjs';

export function createAudienceSyncPublicRoutes(basePath = '/public/audience-sync') {
  const snapshot = buildAudienceSyncSnapshot();
  const fixtures = createAudienceSyncFixtures();
  return [
    { id: 'audience-sync.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'audience-sync.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'audience-sync.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
