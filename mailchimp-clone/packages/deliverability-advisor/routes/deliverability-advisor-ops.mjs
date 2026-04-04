import { buildDeliverabilityAdvisorSnapshot, createDeliverabilityAdvisorReadinessBoard } from '../service-deliverability-advisor.mjs';

export function createDeliverabilityAdvisorOpsRoutes(basePath = '/ops/deliverability-advisor') {
  const snapshot = buildDeliverabilityAdvisorSnapshot();
  return [
    { id: 'deliverability-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityAdvisorReadinessBoard(snapshot) },
    { id: 'deliverability-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

