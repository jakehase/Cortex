import { buildDeliverabilityAtlasSnapshot, createDeliverabilityAtlasReadinessBoard } from '../service-deliverability-atlas.mjs';

export function createDeliverabilityAtlasOpsRoutes(basePath = '/ops/deliverability-atlas') {
  const snapshot = buildDeliverabilityAtlasSnapshot();
  return [
    { id: 'deliverability-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityAtlasReadinessBoard(snapshot) },
    { id: 'deliverability-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

