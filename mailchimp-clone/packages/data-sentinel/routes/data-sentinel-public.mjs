import { buildDataSentinelSnapshot } from '../service-data-sentinel.mjs';
import { createDataSentinelFixtures } from '../fixtures-data-sentinel.mjs';

export function createDataSentinelPublicRoutes(basePath = '/public/data-sentinel') {
  const snapshot = buildDataSentinelSnapshot();
  const fixtures = createDataSentinelFixtures();
  return [
    { id: 'data-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'data-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'data-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

