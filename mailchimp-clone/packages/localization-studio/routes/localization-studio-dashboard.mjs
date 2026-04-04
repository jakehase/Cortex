import { buildLocalizationStudioSnapshot } from '../service-localization-studio.mjs';

export function createLocalizationStudioDashboardRoutes(basePath = '/localization-studio') {
  const snapshot = buildLocalizationStudioSnapshot();
  return [
    { id: 'localization-studio.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'localization-studio.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'localization-studio.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
