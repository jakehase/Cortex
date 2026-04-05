import { buildCustomerDossierSnapshot, createCustomerDossierReadinessBoard } from '../service-customer-dossier.mjs';

export function createCustomerDossierOpsRoutes(basePath = '/ops/customer-dossier') {
  const snapshot = buildCustomerDossierSnapshot();
  return [
    { id: 'customer-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerDossierReadinessBoard(snapshot) },
    { id: 'customer-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

