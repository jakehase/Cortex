import { buildIntegrationsCockpitSnapshot } from '../service-integrations-cockpit.mjs';
import { createIntegrationsCockpitFixtures } from '../fixtures-integrations-cockpit.mjs';

export function createIntegrationsCockpitPublicRoutes(basePath = '/public/integrations-cockpit') {
  const snapshot = buildIntegrationsCockpitSnapshot();
  const fixtures = createIntegrationsCockpitFixtures();
  return [
    { id: 'integrations-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

