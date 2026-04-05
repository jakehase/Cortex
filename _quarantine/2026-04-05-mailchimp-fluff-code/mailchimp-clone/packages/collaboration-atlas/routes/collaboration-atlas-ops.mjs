import { buildCollaborationAtlasSnapshot, createCollaborationAtlasReadinessBoard } from '../service-collaboration-atlas.mjs';

export function createCollaborationAtlasOpsRoutes(basePath = '/ops/collaboration-atlas') {
  const snapshot = buildCollaborationAtlasSnapshot();
  return [
    { id: 'collaboration-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationAtlasReadinessBoard(snapshot) },
    { id: 'collaboration-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

