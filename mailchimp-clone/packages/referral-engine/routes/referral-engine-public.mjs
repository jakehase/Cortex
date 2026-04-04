import { buildReferralEngineSnapshot } from '../service-referral-engine.mjs';
import { createReferralEngineFixtures } from '../fixtures-referral-engine.mjs';

export function createReferralEnginePublicRoutes(basePath = '/public/referral-engine') {
  const snapshot = buildReferralEngineSnapshot();
  const fixtures = createReferralEngineFixtures();
  return [
    { id: 'referral-engine.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'referral-engine.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'referral-engine.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
