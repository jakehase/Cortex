import { buildPartnerAdvisorSnapshot, createPartnerAdvisorReadinessBoard } from '../service-partner-advisor.mjs';

export function createPartnerAdvisorOpsRoutes(basePath = '/ops/partner-advisor') {
  const snapshot = buildPartnerAdvisorSnapshot();
  return [
    { id: 'partner-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createPartnerAdvisorReadinessBoard(snapshot) },
    { id: 'partner-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'partner-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

