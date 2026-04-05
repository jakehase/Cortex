import { buildBenchmarkExchangeSnapshot, createBenchmarkExchangeReadinessBoard } from '../service-benchmark-exchange.mjs';

export function createBenchmarkExchangeOpsRoutes(basePath = '/ops/benchmark-exchange') {
  const snapshot = buildBenchmarkExchangeSnapshot();
  return [
    { id: 'benchmark-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkExchangeReadinessBoard(snapshot) },
    { id: 'benchmark-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

