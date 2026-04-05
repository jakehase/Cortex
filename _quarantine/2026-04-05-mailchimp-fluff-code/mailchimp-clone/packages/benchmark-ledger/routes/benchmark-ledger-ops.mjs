import { buildBenchmarkLedgerSnapshot, createBenchmarkLedgerReadinessBoard } from '../service-benchmark-ledger.mjs';

export function createBenchmarkLedgerOpsRoutes(basePath = '/ops/benchmark-ledger') {
  const snapshot = buildBenchmarkLedgerSnapshot();
  return [
    { id: 'benchmark-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkLedgerReadinessBoard(snapshot) },
    { id: 'benchmark-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

