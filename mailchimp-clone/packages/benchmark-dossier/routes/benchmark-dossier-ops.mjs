import { buildBenchmarkDossierSnapshot, createBenchmarkDossierReadinessBoard } from '../service-benchmark-dossier.mjs';

export function createBenchmarkDossierOpsRoutes(basePath = '/ops/benchmark-dossier') {
  const snapshot = buildBenchmarkDossierSnapshot();
  return [
    { id: 'benchmark-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBenchmarkDossierReadinessBoard(snapshot) },
    { id: 'benchmark-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'benchmark-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

