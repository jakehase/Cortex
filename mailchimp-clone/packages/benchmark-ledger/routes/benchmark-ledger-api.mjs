import { buildBenchmarkLedgerSnapshot, createBenchmarkLedgerApiDocument } from '../service-benchmark-ledger.mjs';

export function createBenchmarkLedgerApiRoutes(basePath = '/api/benchmark-ledger') {
  const snapshot = buildBenchmarkLedgerSnapshot();
  return [
    { id: 'benchmark-ledger.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'benchmark-ledger.api.reporting', method: 'GET', path: basePath + '/reporting', reporting: snapshot.reporting },
    { id: 'benchmark-ledger.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'benchmark-ledger.api.document', method: 'GET', path: basePath + '/document', document: createBenchmarkLedgerApiDocument(snapshot) }
  ];
}

