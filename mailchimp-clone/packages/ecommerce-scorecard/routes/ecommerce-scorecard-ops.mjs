import { buildEcommerceScorecardSnapshot, createEcommerceScorecardReadinessBoard } from '../service-ecommerce-scorecard.mjs';

export function createEcommerceScorecardOpsRoutes(basePath = '/ops/ecommerce-scorecard') {
  const snapshot = buildEcommerceScorecardSnapshot();
  return [
    { id: 'ecommerce-scorecard.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceScorecardReadinessBoard(snapshot) },
    { id: 'ecommerce-scorecard.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-scorecard.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

