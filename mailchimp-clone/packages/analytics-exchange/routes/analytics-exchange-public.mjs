import { buildAnalyticsExchangeSnapshot } from '../service-analytics-exchange.mjs';
import { createAnalyticsExchangeFixtures } from '../fixtures-analytics-exchange.mjs';

export function createAnalyticsExchangePublicRoutes(basePath = '/public/analytics-exchange') {
  const snapshot = buildAnalyticsExchangeSnapshot();
  const fixtures = createAnalyticsExchangeFixtures();
  return [
    { id: 'analytics-exchange.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'analytics-exchange.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'analytics-exchange.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

