import { buildAudienceDossierSnapshot, createAudienceDossierReadinessBoard } from '../service-audience-dossier.mjs';

export function createAudienceDossierOpsRoutes(basePath = '/ops/audience-dossier') {
  const snapshot = buildAudienceDossierSnapshot();
  return [
    { id: 'audience-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceDossierReadinessBoard(snapshot) },
    { id: 'audience-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

