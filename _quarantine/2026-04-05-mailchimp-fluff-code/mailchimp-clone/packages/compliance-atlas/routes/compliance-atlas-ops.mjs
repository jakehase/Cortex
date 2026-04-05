import { buildComplianceAtlasSnapshot, createComplianceAtlasReadinessBoard } from '../service-compliance-atlas.mjs';

export function createComplianceAtlasOpsRoutes(basePath = '/ops/compliance-atlas') {
  const snapshot = buildComplianceAtlasSnapshot();
  return [
    { id: 'compliance-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceAtlasReadinessBoard(snapshot) },
    { id: 'compliance-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

