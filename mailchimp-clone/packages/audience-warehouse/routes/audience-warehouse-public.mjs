import { buildAudienceWarehouseSnapshot } from '../service-audience-warehouse.mjs';
import { createAudienceWarehouseFixtures } from '../fixtures-audience-warehouse.mjs';

export function createAudienceWarehousePublicRoutes(basePath = '/public/audience-warehouse') { const snapshot = buildAudienceWarehouseSnapshot(); const fixtures = createAudienceWarehouseFixtures(); return [{ id: 'audience-warehouse.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'audience-warehouse.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'audience-warehouse.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }
