import { buildDeliverabilityConsoleSnapshot, createDeliverabilityConsoleReadinessBoard } from '../service-deliverability-console.mjs';

export function createDeliverabilityConsoleOpsRoutes(basePath = '/ops/deliverability-console') {
  const snapshot = buildDeliverabilityConsoleSnapshot();
  return [
    { id: 'deliverability-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityConsoleReadinessBoard(snapshot) },
    { id: 'deliverability-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

