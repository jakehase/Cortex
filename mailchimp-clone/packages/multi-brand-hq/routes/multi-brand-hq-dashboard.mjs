import { buildMultiBrandHqSnapshot } from '../service-multi-brand-hq.mjs';

export function createMultiBrandHqDashboardRoutes(basePath = '/multi-brand-hq') {
  const snapshot = buildMultiBrandHqSnapshot();
  return [
    { id: 'multi-brand-hq.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'multi-brand-hq.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'multi-brand-hq.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
