import { buildBenchmarkStudioSnapshot, createBenchmarkStudioChecklist } from '../service-benchmark-studio.mjs';

export function createBenchmarkStudioOpsRoutes(basePath = '/ops/benchmark-studio') { const snapshot = buildBenchmarkStudioSnapshot(); return [{ id: 'benchmark-studio.ops.health', method: 'GET', path: basePath + '/health', checklist: createBenchmarkStudioChecklist(snapshot) }, { id: 'benchmark-studio.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'benchmark-studio.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

