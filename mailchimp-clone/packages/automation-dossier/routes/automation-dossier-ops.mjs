import { buildAutomationDossierSnapshot, createAutomationDossierReadinessBoard } from '../service-automation-dossier.mjs';

export function createAutomationDossierOpsRoutes(basePath = '/ops/automation-dossier') {
  const snapshot = buildAutomationDossierSnapshot();
  return [
    { id: 'automation-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationDossierReadinessBoard(snapshot) },
    { id: 'automation-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

