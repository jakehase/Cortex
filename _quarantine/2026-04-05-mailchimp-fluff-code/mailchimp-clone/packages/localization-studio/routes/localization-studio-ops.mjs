import { buildLocalizationStudioSnapshot, createLocalizationStudioChecklist } from '../service-localization-studio.mjs';

export function createLocalizationStudioOpsRoutes(basePath = '/ops/localization-studio') {
  const snapshot = buildLocalizationStudioSnapshot();
  return [
    { id: 'localization-studio.ops.health', method: 'GET', path: basePath + '/health', checklist: createLocalizationStudioChecklist(snapshot) },
    { id: 'localization-studio.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'localization-studio.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
