import { buildDeliverabilityWorkbenchSnapshot, createDeliverabilityWorkbenchReadinessBoard } from '../service-deliverability-workbench.mjs';

export function createDeliverabilityWorkbenchOpsRoutes(basePath = '/ops/deliverability-workbench') {
  const snapshot = buildDeliverabilityWorkbenchSnapshot();
  return [
    { id: 'deliverability-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityWorkbenchReadinessBoard(snapshot) },
    { id: 'deliverability-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

