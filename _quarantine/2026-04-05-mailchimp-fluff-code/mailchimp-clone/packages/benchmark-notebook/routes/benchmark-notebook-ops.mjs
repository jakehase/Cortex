import { buildBenchmarkNotebookSnapshot, createBenchmarkNotebookReadinessBoard } from '../service-benchmark-notebook.mjs';

export function createBenchmarkNotebookOpsRoutes(basePath = '/ops/benchmark-notebook') {
  const snapshot = buildBenchmarkNotebookSnapshot();
  return [
    { id: 'benchmark-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkNotebookReadinessBoard(snapshot) },
    { id: 'benchmark-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

