import { buildAnalyticsDossierSnapshot, createAnalyticsDossierReadinessBoard } from '../service-analytics-dossier.mjs';

export function createAnalyticsDossierOpsRoutes(basePath = '/ops/analytics-dossier') {
  const snapshot = buildAnalyticsDossierSnapshot();
  return [
    { id: 'analytics-dossier.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAnalyticsDossierReadinessBoard(snapshot) },
    { id: 'analytics-dossier.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'analytics-dossier.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

