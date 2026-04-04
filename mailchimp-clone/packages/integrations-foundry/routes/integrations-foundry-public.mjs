import { buildIntegrationsFoundrySnapshot } from '../service-integrations-foundry.mjs';
import { createIntegrationsFoundryFixtures } from '../fixtures-integrations-foundry.mjs';

export function createIntegrationsFoundryPublicRoutes(basePath = '/public/integrations-foundry') {
  const snapshot = buildIntegrationsFoundrySnapshot();
  const fixtures = createIntegrationsFoundryFixtures();
  return [
    { id: 'integrations-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

