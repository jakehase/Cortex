import { buildBenchmarkPlannerSnapshot, createBenchmarkPlannerRouteSummary } from '../service-benchmark-planner.mjs';

export function createBenchmarkPlannerRegistryRoutes(basePath = '/registry/benchmark-planner') {
  const snapshot = buildBenchmarkPlannerSnapshot();
  return [
    { id: 'benchmark-planner.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkPlannerRouteSummary(snapshot) },
    { id: 'benchmark-planner.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-planner.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

