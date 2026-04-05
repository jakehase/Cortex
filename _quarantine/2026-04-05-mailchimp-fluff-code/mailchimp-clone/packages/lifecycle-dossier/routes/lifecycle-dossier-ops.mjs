import { buildLifecycleDossierSnapshot, createLifecycleDossierReadinessBoard } from '../service-lifecycle-dossier.mjs';

export function createLifecycleDossierOpsRoutes(basePath = '/ops/lifecycle-dossier') {
  const snapshot = buildLifecycleDossierSnapshot();
  return [
    { id: 'lifecycle-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleDossierReadinessBoard(snapshot) },
    { id: 'lifecycle-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

