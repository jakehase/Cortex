import { buildLocalizationWorkbenchSnapshot, createLocalizationWorkbenchReadinessBoard } from '../service-localization-workbench.mjs';

export function createLocalizationWorkbenchOpsRoutes(basePath = '/ops/localization-workbench') {
  const snapshot = buildLocalizationWorkbenchSnapshot();
  return [
    { id: 'localization-workbench.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLocalizationWorkbenchReadinessBoard(snapshot) },
    { id: 'localization-workbench.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'localization-workbench.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

