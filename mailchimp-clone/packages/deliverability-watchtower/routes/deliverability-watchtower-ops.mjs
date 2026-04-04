import { buildDeliverabilityWatchtowerSnapshot, createDeliverabilityWatchtowerReadinessBoard } from '../service-deliverability-watchtower.mjs';

export function createDeliverabilityWatchtowerOpsRoutes(basePath = '/ops/deliverability-watchtower') {
  const snapshot = buildDeliverabilityWatchtowerSnapshot();
  return [
    { id: 'deliverability-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityWatchtowerReadinessBoard(snapshot) },
    { id: 'deliverability-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

