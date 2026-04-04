import { buildAttributionModelingSnapshot } from '../service-attribution-modeling.mjs';
import { createAttributionModelingFixtures } from '../fixtures-attribution-modeling.mjs';

export function createAttributionModelingPublicRoutes(basePath = '/public/attribution-modeling') { const snapshot = buildAttributionModelingSnapshot(); const fixtures = createAttributionModelingFixtures(); return [{ id: 'attribution-modeling.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'attribution-modeling.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'attribution-modeling.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

