import { buildAutomationHubSnapshot } from '../service-automation-hub.mjs';
import { createAutomationHubFixtures } from '../fixtures-automation-hub.mjs';

export function createAutomationHubPublicRoutes(basePath = '/public/automation-hub') {
  const snapshot = buildAutomationHubSnapshot();
  const fixtures = createAutomationHubFixtures();
  return [
    { id: 'automation-hub.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-hub.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-hub.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

