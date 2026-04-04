import { buildContentScorecardSnapshot } from '../service-content-scorecard.mjs';
import { createContentScorecardFixtures } from '../fixtures-content-scorecard.mjs';

export function createContentScorecardPublicRoutes(basePath = '/public/content-scorecard') {
  const snapshot = buildContentScorecardSnapshot();
  const fixtures = createContentScorecardFixtures();
  return [
    { id: 'content-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'content-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'content-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

