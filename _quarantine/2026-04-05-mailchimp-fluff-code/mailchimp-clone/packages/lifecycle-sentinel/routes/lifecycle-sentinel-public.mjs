import { buildLifecycleSentinelSnapshot } from '../service-lifecycle-sentinel.mjs';
import { createLifecycleSentinelFixtures } from '../fixtures-lifecycle-sentinel.mjs';

export function createLifecycleSentinelPublicRoutes(basePath = '/public/lifecycle-sentinel') {
  const snapshot = buildLifecycleSentinelSnapshot();
  const fixtures = createLifecycleSentinelFixtures();
  return [
    { id: 'lifecycle-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'lifecycle-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'lifecycle-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

