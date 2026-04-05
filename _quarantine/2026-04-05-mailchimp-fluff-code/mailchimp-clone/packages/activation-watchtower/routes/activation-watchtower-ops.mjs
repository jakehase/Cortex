import { buildActivationWatchtowerSnapshot, createActivationWatchtowerReadinessBoard } from '../service-activation-watchtower.mjs';

export function createActivationWatchtowerOpsRoutes(basePath = '/ops/activation-watchtower') {
  const snapshot = buildActivationWatchtowerSnapshot();
  return [
    { id: 'activation-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationWatchtowerReadinessBoard(snapshot) },
    { id: 'activation-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

