import { buildCollaborationDossierSnapshot, createCollaborationDossierReadinessBoard } from '../service-collaboration-dossier.mjs';

export function createCollaborationDossierOpsRoutes(basePath = '/ops/collaboration-dossier') {
  const snapshot = buildCollaborationDossierSnapshot();
  return [
    { id: 'collaboration-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationDossierReadinessBoard(snapshot) },
    { id: 'collaboration-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

