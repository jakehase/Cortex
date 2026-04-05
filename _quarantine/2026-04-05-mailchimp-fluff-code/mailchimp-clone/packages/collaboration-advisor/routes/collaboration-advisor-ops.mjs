import { buildCollaborationAdvisorSnapshot, createCollaborationAdvisorReadinessBoard } from '../service-collaboration-advisor.mjs';

export function createCollaborationAdvisorOpsRoutes(basePath = '/ops/collaboration-advisor') {
  const snapshot = buildCollaborationAdvisorSnapshot();
  return [
    { id: 'collaboration-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationAdvisorReadinessBoard(snapshot) },
    { id: 'collaboration-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

