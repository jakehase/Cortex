import { buildIntegrationsScorecardSnapshot, createIntegrationsScorecardReadinessBoard } from '../service-integrations-scorecard.mjs';

export function createIntegrationsScorecardOpsRoutes(basePath = '/ops/integrations-scorecard') {
  const snapshot = buildIntegrationsScorecardSnapshot();
  return [
    { id: 'integrations-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsScorecardReadinessBoard(snapshot) },
    { id: 'integrations-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

