import { buildAutomationFoundrySnapshot } from '../service-automation-foundry.mjs';
import { createAutomationFoundryFixtures } from '../fixtures-automation-foundry.mjs';

export function createAutomationFoundryPublicRoutes(basePath = '/public/automation-foundry') {
  const snapshot = buildAutomationFoundrySnapshot();
  const fixtures = createAutomationFoundryFixtures();
  return [
    { id: 'automation-foundry.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-foundry.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-foundry.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

