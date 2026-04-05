import { buildConsentLedgerSnapshot, createConsentLedgerApiDocument } from '../service-consent-ledger.mjs';

export function createConsentLedgerApiRoutes(basePath = '/api/consent-ledger') { const snapshot = buildConsentLedgerSnapshot(); return [{ id: 'consent-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'consent-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'consent-ledger.api.document', method: 'GET', path: basePath + '/document', document: createConsentLedgerApiDocument(snapshot) }]; }

