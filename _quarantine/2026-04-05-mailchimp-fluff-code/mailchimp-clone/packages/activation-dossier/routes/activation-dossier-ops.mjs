import { buildActivationDossierSnapshot, createActivationDossierReadinessBoard } from '../service-activation-dossier.mjs';

export function createActivationDossierOpsRoutes(basePath = '/ops/activation-dossier') {
  const snapshot = buildActivationDossierSnapshot();
  return [
    { id: 'activation-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationDossierReadinessBoard(snapshot) },
    { id: 'activation-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

