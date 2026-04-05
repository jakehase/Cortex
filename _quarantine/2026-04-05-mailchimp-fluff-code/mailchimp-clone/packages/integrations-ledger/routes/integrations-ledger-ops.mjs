import { buildIntegrationsLedgerSnapshot, createIntegrationsLedgerReadinessBoard } from '../service-integrations-ledger.mjs';

export function createIntegrationsLedgerOpsRoutes(basePath = '/ops/integrations-ledger') {
  const snapshot = buildIntegrationsLedgerSnapshot();
  return [
    { id: 'integrations-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsLedgerReadinessBoard(snapshot) },
    { id: 'integrations-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

