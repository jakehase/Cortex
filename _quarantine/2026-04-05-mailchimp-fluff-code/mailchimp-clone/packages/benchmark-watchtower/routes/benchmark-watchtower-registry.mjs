import { buildBenchmarkWatchtowerSnapshot, createBenchmarkWatchtowerRouteSummary } from '../service-benchmark-watchtower.mjs';

export function createBenchmarkWatchtowerRegistryRoutes(basePath = '/registry/benchmark-watchtower') {
  const snapshot = buildBenchmarkWatchtowerSnapshot();
  return [
    { id: 'benchmark-watchtower.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkWatchtowerRouteSummary(snapshot) },
    { id: 'benchmark-watchtower.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-watchtower.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

