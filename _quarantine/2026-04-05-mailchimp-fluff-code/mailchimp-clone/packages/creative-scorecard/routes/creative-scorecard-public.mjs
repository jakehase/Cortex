import { buildCreativeScorecardSnapshot } from '../service-creative-scorecard.mjs';
import { createCreativeScorecardFixtures } from '../fixtures-creative-scorecard.mjs';

export function createCreativeScorecardPublicRoutes(basePath = '/public/creative-scorecard') {
  const snapshot = buildCreativeScorecardSnapshot();
  const fixtures = createCreativeScorecardFixtures();
  return [
    { id: 'creative-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'creative-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'creative-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

