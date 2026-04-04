import { buildDeliverabilityExchangeSnapshot } from '../service-deliverability-exchange.mjs';
import { createDeliverabilityExchangeFixtures } from '../fixtures-deliverability-exchange.mjs';

export function createDeliverabilityExchangePublicRoutes(basePath = '/public/deliverability-exchange') {
  const snapshot = buildDeliverabilityExchangeSnapshot();
  const fixtures = createDeliverabilityExchangeFixtures();
  return [
    { id: 'deliverability-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

