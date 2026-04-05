import { buildAudienceExchangeSnapshot } from '../service-audience-exchange.mjs';
import { createAudienceExchangeFixtures } from '../fixtures-audience-exchange.mjs';

export function createAudienceExchangePublicRoutes(basePath = '/public/audience-exchange') {
  const snapshot = buildAudienceExchangeSnapshot();
  const fixtures = createAudienceExchangeFixtures();
  return [
    { id: 'audience-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'audience-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'audience-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

