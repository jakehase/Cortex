import { buildAdvocacyDossierSnapshot, createAdvocacyDossierReadinessBoard } from '../service-advocacy-dossier.mjs';

export function createAdvocacyDossierOpsRoutes(basePath = '/ops/advocacy-dossier') {
  const snapshot = buildAdvocacyDossierSnapshot();
  return [
    { id: 'advocacy-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyDossierReadinessBoard(snapshot) },
    { id: 'advocacy-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

