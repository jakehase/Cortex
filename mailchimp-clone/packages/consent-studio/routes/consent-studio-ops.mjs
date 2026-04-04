import { buildConsentStudioSnapshot, createConsentStudioReadinessBoard } from '../service-consent-studio.mjs';

export function createConsentStudioOpsRoutes(basePath = '/ops/consent-studio') {
  const snapshot = buildConsentStudioSnapshot();
  return [
    { id: 'consent-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentStudioReadinessBoard(snapshot) },
    { id: 'consent-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

