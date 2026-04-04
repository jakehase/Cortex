import { buildIntegrationsGridSnapshot } from '../service-integrations-grid.mjs';
import { createIntegrationsGridFixtures } from '../fixtures-integrations-grid.mjs';

export function createIntegrationsGridPublicRoutes(basePath = '/public/integrations-grid') {
  const snapshot = buildIntegrationsGridSnapshot();
  const fixtures = createIntegrationsGridFixtures();
  return [
    { id: 'integrations-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

