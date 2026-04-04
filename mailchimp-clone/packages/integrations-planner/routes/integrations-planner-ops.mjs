import { buildIntegrationsPlannerSnapshot, createIntegrationsPlannerReadinessBoard } from '../service-integrations-planner.mjs';

export function createIntegrationsPlannerOpsRoutes(basePath = '/ops/integrations-planner') {
  const snapshot = buildIntegrationsPlannerSnapshot();
  return [
    { id: 'integrations-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsPlannerReadinessBoard(snapshot) },
    { id: 'integrations-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

