import { buildAudienceWorkbenchSnapshot, createAudienceWorkbenchReadinessBoard } from '../service-audience-workbench.mjs';

export function createAudienceWorkbenchOpsRoutes(basePath = '/ops/audience-workbench') {
  const snapshot = buildAudienceWorkbenchSnapshot();
  return [
    { id: 'audience-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceWorkbenchReadinessBoard(snapshot) },
    { id: 'audience-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

