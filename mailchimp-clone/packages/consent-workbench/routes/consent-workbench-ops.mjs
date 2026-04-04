import { buildConsentWorkbenchSnapshot, createConsentWorkbenchReadinessBoard } from '../service-consent-workbench.mjs';

export function createConsentWorkbenchOpsRoutes(basePath = '/ops/consent-workbench') {
  const snapshot = buildConsentWorkbenchSnapshot();
  return [
    { id: 'consent-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentWorkbenchReadinessBoard(snapshot) },
    { id: 'consent-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

