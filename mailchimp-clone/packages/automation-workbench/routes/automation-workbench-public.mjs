import { buildAutomationWorkbenchSnapshot } from '../service-automation-workbench.mjs';
import { createAutomationWorkbenchFixtures } from '../fixtures-automation-workbench.mjs';

export function createAutomationWorkbenchPublicRoutes(basePath = '/public/automation-workbench') {
  const snapshot = buildAutomationWorkbenchSnapshot();
  const fixtures = createAutomationWorkbenchFixtures();
  return [
    { id: 'automation-workbench.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-workbench.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-workbench.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

