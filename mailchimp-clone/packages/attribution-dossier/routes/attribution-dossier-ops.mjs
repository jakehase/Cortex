import { buildAttributionDossierSnapshot, createAttributionDossierReadinessBoard } from '../service-attribution-dossier.mjs';

export function createAttributionDossierOpsRoutes(basePath = '/ops/attribution-dossier') {
  const snapshot = buildAttributionDossierSnapshot();
  return [
    { id: 'attribution-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionDossierReadinessBoard(snapshot) },
    { id: 'attribution-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

