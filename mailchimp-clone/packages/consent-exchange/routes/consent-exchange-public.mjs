import { buildConsentExchangeSnapshot } from '../service-consent-exchange.mjs';
import { createConsentExchangeFixtures } from '../fixtures-consent-exchange.mjs';

export function createConsentExchangePublicRoutes(basePath = '/public/consent-exchange') {
  const snapshot = buildConsentExchangeSnapshot();
  const fixtures = createConsentExchangeFixtures();
  return [
    { id: 'consent-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'consent-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'consent-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

