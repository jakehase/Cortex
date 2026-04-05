import { buildCreativeDossierSnapshot, createCreativeDossierReadinessBoard } from '../service-creative-dossier.mjs';

export function createCreativeDossierOpsRoutes(basePath = '/ops/creative-dossier') {
  const snapshot = buildCreativeDossierSnapshot();
  return [
    { id: 'creative-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeDossierReadinessBoard(snapshot) },
    { id: 'creative-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

