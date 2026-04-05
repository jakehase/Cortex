import { buildLoyaltyNotebookSnapshot, createLoyaltyNotebookReadinessBoard } from '../service-loyalty-notebook.mjs';

export function createLoyaltyNotebookOpsRoutes(basePath = '/ops/loyalty-notebook') {
  const snapshot = buildLoyaltyNotebookSnapshot();
  return [
    { id: 'loyalty-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyNotebookReadinessBoard(snapshot) },
    { id: 'loyalty-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

