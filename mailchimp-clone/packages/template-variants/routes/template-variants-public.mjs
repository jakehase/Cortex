import { buildTemplateVariantsSnapshot } from '../service-template-variants.mjs';
import { createTemplateVariantsFixtures } from '../fixtures-template-variants.mjs';

export function createTemplateVariantsPublicRoutes(basePath = '/public/template-variants') { const snapshot = buildTemplateVariantsSnapshot(); const fixtures = createTemplateVariantsFixtures(); return [{ id: 'template-variants.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'template-variants.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'template-variants.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

