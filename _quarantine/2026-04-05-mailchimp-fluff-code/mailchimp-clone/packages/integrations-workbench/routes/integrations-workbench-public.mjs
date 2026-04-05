import { buildIntegrationsWorkbenchSnapshot } from '../service-integrations-workbench.mjs';
import { createIntegrationsWorkbenchFixtures } from '../fixtures-integrations-workbench.mjs';

export function createIntegrationsWorkbenchPublicRoutes(basePath = '/public/integrations-workbench') {
  const snapshot = buildIntegrationsWorkbenchSnapshot();
  const fixtures = createIntegrationsWorkbenchFixtures();
  return [
    { id: 'integrations-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

