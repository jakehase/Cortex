import { buildRetentionOffersSnapshot } from '../service-retention-offers.mjs';
import { createRetentionOffersFixtures } from '../fixtures-retention-offers.mjs';

export function createRetentionOffersPublicRoutes(basePath = '/public/retention-offers') { const snapshot = buildRetentionOffersSnapshot(); const fixtures = createRetentionOffersFixtures(); return [{ id: 'retention-offers.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'retention-offers.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'retention-offers.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

