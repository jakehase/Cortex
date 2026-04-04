import { buildCreativeQaSnapshot } from '../service-creative-qa.mjs';
import { createCreativeQaFixtures } from '../fixtures-creative-qa.mjs';

export function createCreativeQaPublicRoutes(basePath = '/public/creative-qa') { const snapshot = buildCreativeQaSnapshot(); const fixtures = createCreativeQaFixtures(); return [{ id: 'creative-qa.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'creative-qa.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'creative-qa.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

