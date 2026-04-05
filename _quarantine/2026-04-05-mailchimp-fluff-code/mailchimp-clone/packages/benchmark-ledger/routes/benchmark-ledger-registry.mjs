import { buildBenchmarkLedgerSnapshot, createBenchmarkLedgerRouteSummary } from '../service-benchmark-ledger.mjs';

export function createBenchmarkLedgerRegistryRoutes(basePath = '/registry/benchmark-ledger') {
  const snapshot = buildBenchmarkLedgerSnapshot();
  return [
    { id: 'benchmark-ledger.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkLedgerRouteSummary(snapshot) },
    { id: 'benchmark-ledger.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-ledger.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

