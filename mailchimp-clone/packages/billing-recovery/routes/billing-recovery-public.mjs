import { buildBillingRecoverySnapshot } from '../service-billing-recovery.mjs';
import { createBillingRecoveryFixtures } from '../fixtures-billing-recovery.mjs';

export function createBillingRecoveryPublicRoutes(basePath = '/public/billing-recovery') { const snapshot = buildBillingRecoverySnapshot(); const fixtures = createBillingRecoveryFixtures(); return [{ id: 'billing-recovery.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'billing-recovery.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'billing-recovery.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }
