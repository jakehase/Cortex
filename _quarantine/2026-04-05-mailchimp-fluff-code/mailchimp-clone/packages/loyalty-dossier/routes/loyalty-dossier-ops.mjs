import { buildLoyaltyDossierSnapshot, createLoyaltyDossierReadinessBoard } from '../service-loyalty-dossier.mjs';

export function createLoyaltyDossierOpsRoutes(basePath = '/ops/loyalty-dossier') {
  const snapshot = buildLoyaltyDossierSnapshot();
  return [
    { id: 'loyalty-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyDossierReadinessBoard(snapshot) },
    { id: 'loyalty-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

