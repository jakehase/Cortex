import { buildBillingScorecardSnapshot } from '../service-billing-scorecard.mjs';
import { createBillingScorecardFixtures } from '../fixtures-billing-scorecard.mjs';

export function createBillingScorecardPublicRoutes(basePath = '/public/billing-scorecard') {
  const snapshot = buildBillingScorecardSnapshot();
  const fixtures = createBillingScorecardFixtures();
  return [
    { id: 'billing-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'billing-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'billing-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

