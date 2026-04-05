import { buildIntegrationsDossierSnapshot, createIntegrationsDossierReadinessBoard } from '../service-integrations-dossier.mjs';

export function createIntegrationsDossierOpsRoutes(basePath = '/ops/integrations-dossier') {
  const snapshot = buildIntegrationsDossierSnapshot();
  return [
    { id: 'integrations-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsDossierReadinessBoard(snapshot) },
    { id: 'integrations-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

