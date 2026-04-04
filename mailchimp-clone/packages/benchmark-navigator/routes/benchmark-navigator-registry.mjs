import { buildBenchmarkNavigatorSnapshot, createBenchmarkNavigatorRouteSummary } from '../service-benchmark-navigator.mjs';

export function createBenchmarkNavigatorRegistryRoutes(basePath = '/registry/benchmark-navigator') {
  const snapshot = buildBenchmarkNavigatorSnapshot();
  return [
    { id: 'benchmark-navigator.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkNavigatorRouteSummary(snapshot) },
    { id: 'benchmark-navigator.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-navigator.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

