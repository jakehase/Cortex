import { buildBenchmarkHubSnapshot, createBenchmarkHubRouteSummary } from '../service-benchmark-hub.mjs';

export function createBenchmarkHubRegistryRoutes(basePath = '/registry/benchmark-hub') {
  const snapshot = buildBenchmarkHubSnapshot();
  return [
    { id: 'benchmark-hub.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkHubRouteSummary(snapshot) },
    { id: 'benchmark-hub.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-hub.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

