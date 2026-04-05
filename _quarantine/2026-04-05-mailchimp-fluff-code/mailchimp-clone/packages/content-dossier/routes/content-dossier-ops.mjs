import { buildContentDossierSnapshot, createContentDossierReadinessBoard } from '../service-content-dossier.mjs';

export function createContentDossierOpsRoutes(basePath = '/ops/content-dossier') {
  const snapshot = buildContentDossierSnapshot();
  return [
    { id: 'content-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentDossierReadinessBoard(snapshot) },
    { id: 'content-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

