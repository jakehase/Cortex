import { buildAttributionSentinelSnapshot } from '../service-attribution-sentinel.mjs';
import { createAttributionSentinelFixtures } from '../fixtures-attribution-sentinel.mjs';

export function createAttributionSentinelPublicRoutes(basePath = '/public/attribution-sentinel') {
  const snapshot = buildAttributionSentinelSnapshot();
  const fixtures = createAttributionSentinelFixtures();
  return [
    { id: 'attribution-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'attribution-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'attribution-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

