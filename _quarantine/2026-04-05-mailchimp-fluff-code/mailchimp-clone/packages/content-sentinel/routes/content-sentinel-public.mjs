import { buildContentSentinelSnapshot } from '../service-content-sentinel.mjs';
import { createContentSentinelFixtures } from '../fixtures-content-sentinel.mjs';

export function createContentSentinelPublicRoutes(basePath = '/public/content-sentinel') {
  const snapshot = buildContentSentinelSnapshot();
  const fixtures = createContentSentinelFixtures();
  return [
    { id: 'content-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

