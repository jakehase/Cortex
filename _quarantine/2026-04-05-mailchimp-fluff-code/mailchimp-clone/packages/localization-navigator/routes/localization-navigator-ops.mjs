import { buildLocalizationNavigatorSnapshot, createLocalizationNavigatorReadinessBoard } from '../service-localization-navigator.mjs';

export function createLocalizationNavigatorOpsRoutes(basePath = '/ops/localization-navigator') {
  const snapshot = buildLocalizationNavigatorSnapshot();
  return [
    { id: 'localization-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationNavigatorReadinessBoard(snapshot) },
    { id: 'localization-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

