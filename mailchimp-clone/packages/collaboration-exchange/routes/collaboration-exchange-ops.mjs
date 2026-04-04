import { buildCollaborationExchangeSnapshot, createCollaborationExchangeReadinessBoard } from '../service-collaboration-exchange.mjs';

export function createCollaborationExchangeOpsRoutes(basePath = '/ops/collaboration-exchange') {
  const snapshot = buildCollaborationExchangeSnapshot();
  return [
    { id: 'collaboration-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationExchangeReadinessBoard(snapshot) },
    { id: 'collaboration-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

