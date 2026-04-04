import { buildLocalizationQaSnapshot } from '../service-localization-qa.mjs';
import { createLocalizationQaFixtures } from '../fixtures-localization-qa.mjs';

export function createLocalizationQaPublicRoutes(basePath = '/public/localization-qa') { const snapshot = buildLocalizationQaSnapshot(); const fixtures = createLocalizationQaFixtures(); return [{ id: 'localization-qa.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'localization-qa.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'localization-qa.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

