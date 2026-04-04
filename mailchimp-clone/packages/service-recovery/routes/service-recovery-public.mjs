import { buildServiceRecoverySnapshot } from '../service-service-recovery.mjs';
import { createServiceRecoveryFixtures } from '../fixtures-service-recovery.mjs';

export function createServiceRecoveryPublicRoutes(basePath = '/public/service-recovery') { const snapshot = buildServiceRecoverySnapshot(); const fixtures = createServiceRecoveryFixtures(); return [{ id: 'service-recovery.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'service-recovery.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'service-recovery.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

