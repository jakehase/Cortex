import { buildDeliverabilityDossierSnapshot, createDeliverabilityDossierReadinessBoard } from '../service-deliverability-dossier.mjs';

export function createDeliverabilityDossierOpsRoutes(basePath = '/ops/deliverability-dossier') {
  const snapshot = buildDeliverabilityDossierSnapshot();
  return [
    { id: 'deliverability-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityDossierReadinessBoard(snapshot) },
    { id: 'deliverability-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

