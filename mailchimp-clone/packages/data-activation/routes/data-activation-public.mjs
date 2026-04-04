import { buildDataActivationSnapshot } from '../service-data-activation.mjs';
import { createDataActivationFixtures } from '../fixtures-data-activation.mjs';

export function createDataActivationPublicRoutes(basePath = '/public/data-activation') { const snapshot = buildDataActivationSnapshot(); const fixtures = createDataActivationFixtures(); return [{ id: 'data-activation.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'data-activation.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'data-activation.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

