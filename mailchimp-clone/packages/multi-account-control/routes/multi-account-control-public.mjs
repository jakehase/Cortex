import { buildMultiAccountControlSnapshot } from '../service-multi-account-control.mjs';
import { createMultiAccountControlFixtures } from '../fixtures-multi-account-control.mjs';

export function createMultiAccountControlPublicRoutes(basePath = '/public/multi-account-control') { const snapshot = buildMultiAccountControlSnapshot(); const fixtures = createMultiAccountControlFixtures(); return [{ id: 'multi-account-control.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'multi-account-control.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'multi-account-control.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

