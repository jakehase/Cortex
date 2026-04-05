import { buildLocalizationIndexSnapshot, createLocalizationIndexReadinessBoard } from '../service-localization-index.mjs';

export function createLocalizationIndexOpsRoutes(basePath = '/ops/localization-index') {
  const snapshot = buildLocalizationIndexSnapshot();
  return [
    { id: 'localization-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationIndexReadinessBoard(snapshot) },
    { id: 'localization-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

