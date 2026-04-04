import { buildLocalizationNotebookSnapshot, createLocalizationNotebookReadinessBoard } from '../service-localization-notebook.mjs';

export function createLocalizationNotebookOpsRoutes(basePath = '/ops/localization-notebook') {
  const snapshot = buildLocalizationNotebookSnapshot();
  return [
    { id: 'localization-notebook.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationNotebookReadinessBoard(snapshot) },
    { id: 'localization-notebook.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-notebook.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

