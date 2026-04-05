import { buildBenchmarkScorecardSnapshot, createBenchmarkScorecardRouteSummary } from '../service-benchmark-scorecard.mjs';

export function createBenchmarkScorecardRegistryRoutes(basePath = '/registry/benchmark-scorecard') {
  const snapshot = buildBenchmarkScorecardSnapshot();
  return [
    { id: 'benchmark-scorecard.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkScorecardRouteSummary(snapshot) },
    { id: 'benchmark-scorecard.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-scorecard.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

