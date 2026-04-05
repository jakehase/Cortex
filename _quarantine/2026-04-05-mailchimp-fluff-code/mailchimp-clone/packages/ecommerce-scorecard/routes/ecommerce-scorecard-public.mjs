import { buildEcommerceScorecardSnapshot } from '../service-ecommerce-scorecard.mjs';
import { createEcommerceScorecardFixtures } from '../fixtures-ecommerce-scorecard.mjs';

export function createEcommerceScorecardPublicRoutes(basePath = '/public/ecommerce-scorecard') {
  const snapshot = buildEcommerceScorecardSnapshot();
  const fixtures = createEcommerceScorecardFixtures();
  return [
    { id: 'ecommerce-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'ecommerce-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'ecommerce-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

