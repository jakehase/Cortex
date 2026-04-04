import { buildIntegrationsScorecardSnapshot } from '../service-integrations-scorecard.mjs';
import { createIntegrationsScorecardFixtures } from '../fixtures-integrations-scorecard.mjs';

export function createIntegrationsScorecardPublicRoutes(basePath = '/public/integrations-scorecard') {
  const snapshot = buildIntegrationsScorecardSnapshot();
  const fixtures = createIntegrationsScorecardFixtures();
  return [
    { id: 'integrations-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'integrations-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'integrations-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

