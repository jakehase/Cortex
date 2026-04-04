import { buildConsentLedgerSnapshot } from '../service-consent-ledger.mjs';

export function createConsentLedgerDashboardRoutes(basePath = '/consent-ledger') { const snapshot = buildConsentLedgerSnapshot(); return [{ id: 'consent-ledger.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'consent-ledger.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'consent-ledger.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

