import { buildBillingDossierSnapshot, createBillingDossierReadinessBoard } from '../service-billing-dossier.mjs';

export function createBillingDossierOpsRoutes(basePath = '/ops/billing-dossier') {
  const snapshot = buildBillingDossierSnapshot();
  return [
    { id: 'billing-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingDossierReadinessBoard(snapshot) },
    { id: 'billing-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

