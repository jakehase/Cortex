import { buildBenchmarkIndexSnapshot, createBenchmarkIndexRouteSummary } from '../service-benchmark-index.mjs';

export function createBenchmarkIndexRegistryRoutes(basePath = '/registry/benchmark-index') {
  const snapshot = buildBenchmarkIndexSnapshot();
  return [
    { id: 'benchmark-index.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkIndexRouteSummary(snapshot) },
    { id: 'benchmark-index.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-index.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

