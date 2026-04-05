import { buildExperimentationLedgerSnapshot, createExperimentationLedgerReadinessBoard } from '../service-experimentation-ledger.mjs';

export function createExperimentationLedgerOpsRoutes(basePath = '/ops/experimentation-ledger') {
  const snapshot = buildExperimentationLedgerSnapshot();
  return [
    { id: 'experimentation-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createExperimentationLedgerReadinessBoard(snapshot) },
    { id: 'experimentation-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'experimentation-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

