import { buildConsentScorecardSnapshot } from '../service-consent-scorecard.mjs';
import { createConsentScorecardFixtures } from '../fixtures-consent-scorecard.mjs';

export function createConsentScorecardPublicRoutes(basePath = '/public/consent-scorecard') {
  const snapshot = buildConsentScorecardSnapshot();
  const fixtures = createConsentScorecardFixtures();
  return [
    { id: 'consent-scorecard.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-scorecard.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-scorecard.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

