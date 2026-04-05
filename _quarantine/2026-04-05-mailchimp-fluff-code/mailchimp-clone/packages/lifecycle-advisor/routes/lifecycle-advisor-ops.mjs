import { buildLifecycleAdvisorSnapshot, createLifecycleAdvisorReadinessBoard } from '../service-lifecycle-advisor.mjs';

export function createLifecycleAdvisorOpsRoutes(basePath = '/ops/lifecycle-advisor') {
  const snapshot = buildLifecycleAdvisorSnapshot();
  return [
    { id: 'lifecycle-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleAdvisorReadinessBoard(snapshot) },
    { id: 'lifecycle-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

