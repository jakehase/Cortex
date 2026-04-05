import { buildLocalizationExchangeSnapshot } from '../service-localization-exchange.mjs';
import { createLocalizationExchangeFixtures } from '../fixtures-localization-exchange.mjs';

export function createLocalizationExchangePublicRoutes(basePath = '/public/localization-exchange') {
  const snapshot = buildLocalizationExchangeSnapshot();
  const fixtures = createLocalizationExchangeFixtures();
  return [
    { id: 'localization-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'localization-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'localization-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

