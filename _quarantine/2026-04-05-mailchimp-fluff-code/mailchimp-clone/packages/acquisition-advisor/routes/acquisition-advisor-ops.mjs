import { buildAcquisitionAdvisorSnapshot, createAcquisitionAdvisorReadinessBoard } from '../service-acquisition-advisor.mjs';

export function createAcquisitionAdvisorOpsRoutes(basePath = '/ops/acquisition-advisor') {
  const snapshot = buildAcquisitionAdvisorSnapshot();
  return [
    { id: 'acquisition-advisor.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionAdvisorReadinessBoard(snapshot) },
    { id: 'acquisition-advisor.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-advisor.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

