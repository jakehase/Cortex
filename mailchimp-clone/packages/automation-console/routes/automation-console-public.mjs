import { buildAutomationConsoleSnapshot } from '../service-automation-console.mjs';
import { createAutomationConsoleFixtures } from '../fixtures-automation-console.mjs';

export function createAutomationConsolePublicRoutes(basePath = '/public/automation-console') {
  const snapshot = buildAutomationConsoleSnapshot();
  const fixtures = createAutomationConsoleFixtures();
  return [
    { id: 'automation-console.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-console.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-console.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

