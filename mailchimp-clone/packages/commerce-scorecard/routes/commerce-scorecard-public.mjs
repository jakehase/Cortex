import { buildCommerceScorecardSnapshot } from '../service-commerce-scorecard.mjs';
import { createCommerceScorecardFixtures } from '../fixtures-commerce-scorecard.mjs';

export function createCommerceScorecardPublicRoutes(basePath = '/public/commerce-scorecard') {
  const snapshot = buildCommerceScorecardSnapshot();
  const fixtures = createCommerceScorecardFixtures();
  return [
    { id: 'commerce-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'commerce-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'commerce-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

