import { buildCollaborationCockpitSnapshot, createCollaborationCockpitReadinessBoard } from '../service-collaboration-cockpit.mjs';

export function createCollaborationCockpitOpsRoutes(basePath = '/ops/collaboration-cockpit') {
  const snapshot = buildCollaborationCockpitSnapshot();
  return [
    { id: 'collaboration-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationCockpitReadinessBoard(snapshot) },
    { id: 'collaboration-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

