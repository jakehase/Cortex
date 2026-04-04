import { buildAutomationNavigatorSnapshot } from '../service-automation-navigator.mjs';
import { createAutomationNavigatorFixtures } from '../fixtures-automation-navigator.mjs';

export function createAutomationNavigatorPublicRoutes(basePath = '/public/automation-navigator') {
  const snapshot = buildAutomationNavigatorSnapshot();
  const fixtures = createAutomationNavigatorFixtures();
  return [
    { id: 'automation-navigator.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-navigator.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-navigator.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

