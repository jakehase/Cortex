import { buildAudienceScorecardSnapshot } from '../service-audience-scorecard.mjs';
import { createAudienceScorecardFixtures } from '../fixtures-audience-scorecard.mjs';

export function createAudienceScorecardPublicRoutes(basePath = '/public/audience-scorecard') {
  const snapshot = buildAudienceScorecardSnapshot();
  const fixtures = createAudienceScorecardFixtures();
  return [
    { id: 'audience-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

