import { buildConsentLedgerSnapshot } from '../service-consent-ledger.mjs';
import { createConsentLedgerFixtures } from '../fixtures-consent-ledger.mjs';

export function createConsentLedgerPublicRoutes(basePath = '/public/consent-ledger') { const snapshot = buildConsentLedgerSnapshot(); const fixtures = createConsentLedgerFixtures(); return [{ id: 'consent-ledger.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'consent-ledger.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'consent-ledger.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

