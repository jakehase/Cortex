import { buildComplianceDossierSnapshot, createComplianceDossierReadinessBoard } from '../service-compliance-dossier.mjs';

export function createComplianceDossierOpsRoutes(basePath = '/ops/compliance-dossier') {
  const snapshot = buildComplianceDossierSnapshot();
  return [
    { id: 'compliance-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceDossierReadinessBoard(snapshot) },
    { id: 'compliance-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

