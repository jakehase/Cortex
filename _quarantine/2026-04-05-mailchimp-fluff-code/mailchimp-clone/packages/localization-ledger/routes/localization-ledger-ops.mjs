import { buildLocalizationLedgerSnapshot, createLocalizationLedgerReadinessBoard } from '../service-localization-ledger.mjs';

export function createLocalizationLedgerOpsRoutes(basePath = '/ops/localization-ledger') {
  const snapshot = buildLocalizationLedgerSnapshot();
  return [
    { id: 'localization-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationLedgerReadinessBoard(snapshot) },
    { id: 'localization-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

