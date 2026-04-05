import { buildActivationSentinelSnapshot } from '../service-activation-sentinel.mjs';
import { createActivationSentinelFixtures } from '../fixtures-activation-sentinel.mjs';

export function createActivationSentinelPublicRoutes(basePath = '/public/activation-sentinel') {
  const snapshot = buildActivationSentinelSnapshot();
  const fixtures = createActivationSentinelFixtures();
  return [
    { id: 'activation-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'activation-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'activation-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

