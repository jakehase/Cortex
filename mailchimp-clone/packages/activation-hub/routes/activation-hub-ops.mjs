import { buildActivationHubSnapshot, createActivationHubReadinessBoard } from '../service-activation-hub.mjs';

export function createActivationHubOpsRoutes(basePath = '/ops/activation-hub') {
  const snapshot = buildActivationHubSnapshot();
  return [
    { id: 'activation-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationHubReadinessBoard(snapshot) },
    { id: 'activation-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

