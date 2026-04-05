import { buildIntegrationsNavigatorSnapshot } from '../service-integrations-navigator.mjs';
import { createIntegrationsNavigatorFixtures } from '../fixtures-integrations-navigator.mjs';

export function createIntegrationsNavigatorPublicRoutes(basePath = '/public/integrations-navigator') {
  const snapshot = buildIntegrationsNavigatorSnapshot();
  const fixtures = createIntegrationsNavigatorFixtures();
  return [
    { id: 'integrations-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

