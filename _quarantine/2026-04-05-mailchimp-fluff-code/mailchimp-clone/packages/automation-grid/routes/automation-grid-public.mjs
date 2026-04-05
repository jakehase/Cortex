import { buildAutomationGridSnapshot } from '../service-automation-grid.mjs';
import { createAutomationGridFixtures } from '../fixtures-automation-grid.mjs';

export function createAutomationGridPublicRoutes(basePath = '/public/automation-grid') {
  const snapshot = buildAutomationGridSnapshot();
  const fixtures = createAutomationGridFixtures();
  return [
    { id: 'automation-grid.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-grid.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-grid.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

