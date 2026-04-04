import { buildDeliverabilityScorecardSnapshot, createDeliverabilityScorecardReadinessBoard } from '../service-deliverability-scorecard.mjs';

export function createDeliverabilityScorecardOpsRoutes(basePath = '/ops/deliverability-scorecard') {
  const snapshot = buildDeliverabilityScorecardSnapshot();
  return [
    { id: 'deliverability-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityScorecardReadinessBoard(snapshot) },
    { id: 'deliverability-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

