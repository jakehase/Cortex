import { buildComplianceCockpitSnapshot, createComplianceCockpitReadinessBoard } from '../service-compliance-cockpit.mjs';

export function createComplianceCockpitOpsRoutes(basePath = '/ops/compliance-cockpit') {
  const snapshot = buildComplianceCockpitSnapshot();
  return [
    { id: 'compliance-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceCockpitReadinessBoard(snapshot) },
    { id: 'compliance-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

