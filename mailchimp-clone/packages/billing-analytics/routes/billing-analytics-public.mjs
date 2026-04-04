import { buildBillingAnalyticsSnapshot } from '../service-billing-analytics.mjs';
import { createBillingAnalyticsFixtures } from '../fixtures-billing-analytics.mjs';

export function createBillingAnalyticsPublicRoutes(basePath = '/public/billing-analytics') {
  const snapshot = buildBillingAnalyticsSnapshot();
  const fixtures = createBillingAnalyticsFixtures();
  return [
    { id: 'billing-analytics.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'billing-analytics.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'billing-analytics.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
