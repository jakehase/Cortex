import { buildAcquisitionExchangeSnapshot } from '../service-acquisition-exchange.mjs';
import { createAcquisitionExchangeFixtures } from '../fixtures-acquisition-exchange.mjs';

export function createAcquisitionExchangePublicRoutes(basePath = '/public/acquisition-exchange') {
  const snapshot = buildAcquisitionExchangeSnapshot();
  const fixtures = createAcquisitionExchangeFixtures();
  return [
    { id: 'acquisition-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'acquisition-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'acquisition-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

