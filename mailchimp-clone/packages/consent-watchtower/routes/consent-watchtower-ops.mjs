import { buildConsentWatchtowerSnapshot, createConsentWatchtowerReadinessBoard } from '../service-consent-watchtower.mjs';

export function createConsentWatchtowerOpsRoutes(basePath = '/ops/consent-watchtower') {
  const snapshot = buildConsentWatchtowerSnapshot();
  return [
    { id: 'consent-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentWatchtowerReadinessBoard(snapshot) },
    { id: 'consent-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

