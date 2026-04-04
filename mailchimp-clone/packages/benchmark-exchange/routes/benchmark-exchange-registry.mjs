import { buildBenchmarkExchangeSnapshot, createBenchmarkExchangeRouteSummary } from '../service-benchmark-exchange.mjs';

export function createBenchmarkExchangeRegistryRoutes(basePath = '/registry/benchmark-exchange') {
  const snapshot = buildBenchmarkExchangeSnapshot();
  return [
    { id: 'benchmark-exchange.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkExchangeRouteSummary(snapshot) },
    { id: 'benchmark-exchange.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-exchange.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

