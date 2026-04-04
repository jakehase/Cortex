import { buildAutomationStudioSnapshot } from '../service-automation-studio.mjs';
import { createAutomationStudioFixtures } from '../fixtures-automation-studio.mjs';

export function createAutomationStudioPublicRoutes(basePath = '/public/automation-studio') {
  const snapshot = buildAutomationStudioSnapshot();
  const fixtures = createAutomationStudioFixtures();
  return [
    { id: 'automation-studio.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-studio.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-studio.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

