import { buildCustomerHealthSnapshot } from '../service-customer-health.mjs';
import { createCustomerHealthFixtures } from '../fixtures-customer-health.mjs';

export function createCustomerHealthPublicRoutes(basePath = '/public/customer-health') { const snapshot = buildCustomerHealthSnapshot(); const fixtures = createCustomerHealthFixtures(); return [{ id: 'customer-health.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'customer-health.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'customer-health.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

