import { buildConsentPlannerSnapshot, createConsentPlannerReadinessBoard } from '../service-consent-planner.mjs';

export function createConsentPlannerOpsRoutes(basePath = '/ops/consent-planner') {
  const snapshot = buildConsentPlannerSnapshot();
  return [
    { id: 'consent-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentPlannerReadinessBoard(snapshot) },
    { id: 'consent-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

