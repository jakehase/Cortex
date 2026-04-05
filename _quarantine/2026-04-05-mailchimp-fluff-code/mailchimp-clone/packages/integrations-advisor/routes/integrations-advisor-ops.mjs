import { buildIntegrationsAdvisorSnapshot, createIntegrationsAdvisorReadinessBoard } from '../service-integrations-advisor.mjs';

export function createIntegrationsAdvisorOpsRoutes(basePath = '/ops/integrations-advisor') {
  const snapshot = buildIntegrationsAdvisorSnapshot();
  return [
    { id: 'integrations-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createIntegrationsAdvisorReadinessBoard(snapshot) },
    { id: 'integrations-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'integrations-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

