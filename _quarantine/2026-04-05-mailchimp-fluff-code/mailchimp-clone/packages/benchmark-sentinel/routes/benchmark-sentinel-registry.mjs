import { buildBenchmarkSentinelSnapshot, createBenchmarkSentinelRouteSummary } from '../service-benchmark-sentinel.mjs';

export function createBenchmarkSentinelRegistryRoutes(basePath = '/registry/benchmark-sentinel') {
  const snapshot = buildBenchmarkSentinelSnapshot();
  return [
    { id: 'benchmark-sentinel.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkSentinelRouteSummary(snapshot) },
    { id: 'benchmark-sentinel.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-sentinel.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

