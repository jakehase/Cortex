import { buildCommerceDossierSnapshot, createCommerceDossierReadinessBoard } from '../service-commerce-dossier.mjs';

export function createCommerceDossierOpsRoutes(basePath = '/ops/commerce-dossier') {
  const snapshot = buildCommerceDossierSnapshot();
  return [
    { id: 'commerce-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceDossierReadinessBoard(snapshot) },
    { id: 'commerce-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

