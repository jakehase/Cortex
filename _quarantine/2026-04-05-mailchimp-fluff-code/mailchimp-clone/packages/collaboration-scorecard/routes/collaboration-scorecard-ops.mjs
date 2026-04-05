import { buildCollaborationScorecardSnapshot, createCollaborationScorecardReadinessBoard } from '../service-collaboration-scorecard.mjs';

export function createCollaborationScorecardOpsRoutes(basePath = '/ops/collaboration-scorecard') {
  const snapshot = buildCollaborationScorecardSnapshot();
  return [
    { id: 'collaboration-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationScorecardReadinessBoard(snapshot) },
    { id: 'collaboration-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

