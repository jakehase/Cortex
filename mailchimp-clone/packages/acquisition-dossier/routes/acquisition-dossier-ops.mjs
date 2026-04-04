import { buildAcquisitionDossierSnapshot, createAcquisitionDossierReadinessBoard } from '../service-acquisition-dossier.mjs';

export function createAcquisitionDossierOpsRoutes(basePath = '/ops/acquisition-dossier') {
  const snapshot = buildAcquisitionDossierSnapshot();
  return [
    { id: 'acquisition-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionDossierReadinessBoard(snapshot) },
    { id: 'acquisition-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

