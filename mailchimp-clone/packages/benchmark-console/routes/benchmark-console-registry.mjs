import { buildBenchmarkConsoleSnapshot, createBenchmarkConsoleRouteSummary } from '../service-benchmark-console.mjs';

export function createBenchmarkConsoleRegistryRoutes(basePath = '/registry/benchmark-console') {
  const snapshot = buildBenchmarkConsoleSnapshot();
  return [
    { id: 'benchmark-console.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkConsoleRouteSummary(snapshot) },
    { id: 'benchmark-console.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-console.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

