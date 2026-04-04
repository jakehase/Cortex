import { buildTrustAutomationSnapshot } from '../service-trust-automation.mjs';
import { createTrustAutomationFixtures } from '../fixtures-trust-automation.mjs';

export function createTrustAutomationPublicRoutes(basePath = '/public/trust-automation') { const snapshot = buildTrustAutomationSnapshot(); const fixtures = createTrustAutomationFixtures(); return [{ id: 'trust-automation.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'trust-automation.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'trust-automation.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

