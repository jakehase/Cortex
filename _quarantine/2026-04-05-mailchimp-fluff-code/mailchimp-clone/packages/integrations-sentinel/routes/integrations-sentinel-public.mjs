import { buildIntegrationsSentinelSnapshot } from '../service-integrations-sentinel.mjs';
import { createIntegrationsSentinelFixtures } from '../fixtures-integrations-sentinel.mjs';

export function createIntegrationsSentinelPublicRoutes(basePath = '/public/integrations-sentinel') {
  const snapshot = buildIntegrationsSentinelSnapshot();
  const fixtures = createIntegrationsSentinelFixtures();
  return [
    { id: 'integrations-sentinel.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-sentinel.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-sentinel.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

