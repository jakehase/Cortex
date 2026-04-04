import { buildAutomationIndexSnapshot } from '../service-automation-index.mjs';
import { createAutomationIndexFixtures } from '../fixtures-automation-index.mjs';

export function createAutomationIndexPublicRoutes(basePath = '/public/automation-index') {
  const snapshot = buildAutomationIndexSnapshot();
  const fixtures = createAutomationIndexFixtures();
  return [
    { id: 'automation-index.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-index.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-index.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

