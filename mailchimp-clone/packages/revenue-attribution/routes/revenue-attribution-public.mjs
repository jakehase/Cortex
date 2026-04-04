import { buildRevenueAttributionSnapshot } from '../service-revenue-attribution.mjs';
import { createRevenueAttributionFixtures } from '../fixtures-revenue-attribution.mjs';

export function createRevenueAttributionPublicRoutes(basePath = '/public/revenue-attribution') { const snapshot = buildRevenueAttributionSnapshot(); const fixtures = createRevenueAttributionFixtures(); return [{ id: 'revenue-attribution.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'revenue-attribution.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'revenue-attribution.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

