import { buildConsentConsoleSnapshot, createConsentConsoleReadinessBoard } from '../service-consent-console.mjs';

export function createConsentConsoleOpsRoutes(basePath = '/ops/consent-console') {
  const snapshot = buildConsentConsoleSnapshot();
  return [
    { id: 'consent-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentConsoleReadinessBoard(snapshot) },
    { id: 'consent-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

