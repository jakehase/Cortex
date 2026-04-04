import { buildLocalizationGridSnapshot, createLocalizationGridReadinessBoard } from '../service-localization-grid.mjs';

export function createLocalizationGridOpsRoutes(basePath = '/ops/localization-grid') {
  const snapshot = buildLocalizationGridSnapshot();
  return [
    { id: 'localization-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationGridReadinessBoard(snapshot) },
    { id: 'localization-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

