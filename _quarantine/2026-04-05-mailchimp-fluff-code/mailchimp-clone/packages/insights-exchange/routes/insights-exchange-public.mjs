import { buildInsightsExchangeSnapshot } from '../service-insights-exchange.mjs';
import { createInsightsExchangeFixtures } from '../fixtures-insights-exchange.mjs';

export function createInsightsExchangePublicRoutes(basePath = '/public/insights-exchange') {
  const snapshot = buildInsightsExchangeSnapshot();
  const fixtures = createInsightsExchangeFixtures();
  return [
    { id: 'insights-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'insights-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'insights-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

