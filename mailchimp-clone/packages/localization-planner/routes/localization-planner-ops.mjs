import { buildLocalizationPlannerSnapshot, createLocalizationPlannerReadinessBoard } from '../service-localization-planner.mjs';

export function createLocalizationPlannerOpsRoutes(basePath = '/ops/localization-planner') {
  const snapshot = buildLocalizationPlannerSnapshot();
  return [
    { id: 'localization-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationPlannerReadinessBoard(snapshot) },
    { id: 'localization-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

