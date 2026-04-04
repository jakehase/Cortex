import { buildDataResidencySnapshot } from '../service-data-residency.mjs';

export function createDataResidencyDashboardRoutes(basePath = '/data-residency') {
  const snapshot = buildDataResidencySnapshot();
  return [
    { id: 'data-residency.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'data-residency.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'data-residency.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
