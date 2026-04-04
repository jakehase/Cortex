import { buildAutomationCockpitSnapshot } from '../service-automation-cockpit.mjs';
import { createAutomationCockpitFixtures } from '../fixtures-automation-cockpit.mjs';

export function createAutomationCockpitPublicRoutes(basePath = '/public/automation-cockpit') {
  const snapshot = buildAutomationCockpitSnapshot();
  const fixtures = createAutomationCockpitFixtures();
  return [
    { id: 'automation-cockpit.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-cockpit.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-cockpit.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

