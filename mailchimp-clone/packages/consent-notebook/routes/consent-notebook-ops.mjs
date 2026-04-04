import { buildConsentNotebookSnapshot, createConsentNotebookReadinessBoard } from '../service-consent-notebook.mjs';

export function createConsentNotebookOpsRoutes(basePath = '/ops/consent-notebook') {
  const snapshot = buildConsentNotebookSnapshot();
  return [
    { id: 'consent-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createConsentNotebookReadinessBoard(snapshot) },
    { id: 'consent-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'consent-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

