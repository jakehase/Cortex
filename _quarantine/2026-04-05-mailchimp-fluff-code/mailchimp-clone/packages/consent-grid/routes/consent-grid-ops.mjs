import { buildConsentGridSnapshot, createConsentGridReadinessBoard } from '../service-consent-grid.mjs';

export function createConsentGridOpsRoutes(basePath = '/ops/consent-grid') {
  const snapshot = buildConsentGridSnapshot();
  return [
    { id: 'consent-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentGridReadinessBoard(snapshot) },
    { id: 'consent-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

