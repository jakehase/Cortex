import { buildActivationAdvisorSnapshot, createActivationAdvisorReadinessBoard } from '../service-activation-advisor.mjs';

export function createActivationAdvisorOpsRoutes(basePath = '/ops/activation-advisor') {
  const snapshot = buildActivationAdvisorSnapshot();
  return [
    { id: 'activation-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationAdvisorReadinessBoard(snapshot) },
    { id: 'activation-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

