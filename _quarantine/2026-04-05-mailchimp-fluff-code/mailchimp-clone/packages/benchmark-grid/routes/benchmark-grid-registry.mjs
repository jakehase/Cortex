import { buildBenchmarkGridSnapshot, createBenchmarkGridRouteSummary } from '../service-benchmark-grid.mjs';

export function createBenchmarkGridRegistryRoutes(basePath = '/registry/benchmark-grid') {
  const snapshot = buildBenchmarkGridSnapshot();
  return [
    { id: 'benchmark-grid.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkGridRouteSummary(snapshot) },
    { id: 'benchmark-grid.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-grid.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

