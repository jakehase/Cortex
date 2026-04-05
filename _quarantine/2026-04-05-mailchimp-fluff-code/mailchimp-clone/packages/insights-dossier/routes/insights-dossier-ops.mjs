import { buildInsightsDossierSnapshot, createInsightsDossierReadinessBoard } from '../service-insights-dossier.mjs';

export function createInsightsDossierOpsRoutes(basePath = '/ops/insights-dossier') {
  const snapshot = buildInsightsDossierSnapshot();
  return [
    { id: 'insights-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createInsightsDossierReadinessBoard(snapshot) },
    { id: 'insights-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'insights-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

