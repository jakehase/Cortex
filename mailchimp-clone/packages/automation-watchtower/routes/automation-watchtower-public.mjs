import { buildAutomationWatchtowerSnapshot } from '../service-automation-watchtower.mjs';
import { createAutomationWatchtowerFixtures } from '../fixtures-automation-watchtower.mjs';

export function createAutomationWatchtowerPublicRoutes(basePath = '/public/automation-watchtower') {
  const snapshot = buildAutomationWatchtowerSnapshot();
  const fixtures = createAutomationWatchtowerFixtures();
  return [
    { id: 'automation-watchtower.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-watchtower.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-watchtower.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

