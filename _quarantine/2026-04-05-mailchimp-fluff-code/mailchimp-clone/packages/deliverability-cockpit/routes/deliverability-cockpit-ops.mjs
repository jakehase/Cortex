import { buildDeliverabilityCockpitSnapshot, createDeliverabilityCockpitReadinessBoard } from '../service-deliverability-cockpit.mjs';

export function createDeliverabilityCockpitOpsRoutes(basePath = '/ops/deliverability-cockpit') {
  const snapshot = buildDeliverabilityCockpitSnapshot();
  return [
    { id: 'deliverability-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityCockpitReadinessBoard(snapshot) },
    { id: 'deliverability-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

