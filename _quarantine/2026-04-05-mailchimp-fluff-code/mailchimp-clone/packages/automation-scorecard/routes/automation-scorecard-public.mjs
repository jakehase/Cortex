import { buildAutomationScorecardSnapshot } from '../service-automation-scorecard.mjs';
import { createAutomationScorecardFixtures } from '../fixtures-automation-scorecard.mjs';

export function createAutomationScorecardPublicRoutes(basePath = '/public/automation-scorecard') {
  const snapshot = buildAutomationScorecardSnapshot();
  const fixtures = createAutomationScorecardFixtures();
  return [
    { id: 'automation-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'automation-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'automation-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

