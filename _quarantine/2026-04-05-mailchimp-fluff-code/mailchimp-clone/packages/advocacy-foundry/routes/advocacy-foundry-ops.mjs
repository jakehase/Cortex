import { buildAdvocacyFoundrySnapshot, createAdvocacyFoundryReadinessBoard } from '../service-advocacy-foundry.mjs';

export function createAdvocacyFoundryOpsRoutes(basePath = '/ops/advocacy-foundry') {
  const snapshot = buildAdvocacyFoundrySnapshot();
  return [
    { id: 'advocacy-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyFoundryReadinessBoard(snapshot) },
    { id: 'advocacy-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

