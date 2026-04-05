import { buildConsentLedgerSnapshot, createConsentLedgerChecklist } from '../service-consent-ledger.mjs';

export function createConsentLedgerOpsRoutes(basePath = '/ops/consent-ledger') { const snapshot = buildConsentLedgerSnapshot(); return [{ id: 'consent-ledger.ops.health', method: 'GET', path: basePath + '/health', checklist: createConsentLedgerChecklist(snapshot) }, { id: 'consent-ledger.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'consent-ledger.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

