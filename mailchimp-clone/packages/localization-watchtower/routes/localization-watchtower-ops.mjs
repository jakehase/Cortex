import { buildLocalizationWatchtowerSnapshot, createLocalizationWatchtowerReadinessBoard } from '../service-localization-watchtower.mjs';

export function createLocalizationWatchtowerOpsRoutes(basePath = '/ops/localization-watchtower') {
  const snapshot = buildLocalizationWatchtowerSnapshot();
  return [
    { id: 'localization-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationWatchtowerReadinessBoard(snapshot) },
    { id: 'localization-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

