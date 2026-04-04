import { buildDataDossierSnapshot, createDataDossierReadinessBoard } from '../service-data-dossier.mjs';

export function createDataDossierOpsRoutes(basePath = '/ops/data-dossier') {
  const snapshot = buildDataDossierSnapshot();
  return [
    { id: 'data-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataDossierReadinessBoard(snapshot) },
    { id: 'data-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

