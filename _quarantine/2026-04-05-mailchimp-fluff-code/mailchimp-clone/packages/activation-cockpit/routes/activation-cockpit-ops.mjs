import { buildActivationCockpitSnapshot, createActivationCockpitReadinessBoard } from '../service-activation-cockpit.mjs';

export function createActivationCockpitOpsRoutes(basePath = '/ops/activation-cockpit') {
  const snapshot = buildActivationCockpitSnapshot();
  return [
    { id: 'activation-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationCockpitReadinessBoard(snapshot) },
    { id: 'activation-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

