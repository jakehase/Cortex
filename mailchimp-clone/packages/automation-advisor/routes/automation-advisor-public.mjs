import { buildAutomationAdvisorSnapshot } from '../service-automation-advisor.mjs';
import { createAutomationAdvisorFixtures } from '../fixtures-automation-advisor.mjs';

export function createAutomationAdvisorPublicRoutes(basePath = '/public/automation-advisor') {
  const snapshot = buildAutomationAdvisorSnapshot();
  const fixtures = createAutomationAdvisorFixtures();
  return [
    { id: 'automation-advisor.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-advisor.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-advisor.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

