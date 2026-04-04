import { buildCreativeBriefBuilderSnapshot } from '../service-creative-brief-builder.mjs';
import { createCreativeBriefBuilderFixtures } from '../fixtures-creative-brief-builder.mjs';

export function createCreativeBriefBuilderPublicRoutes(basePath = '/public/creative-brief-builder') { const snapshot = buildCreativeBriefBuilderSnapshot(); const fixtures = createCreativeBriefBuilderFixtures(); return [{ id: 'creative-brief-builder.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'creative-brief-builder.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'creative-brief-builder.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

