import { buildRetentionLabSnapshot } from '../service-retention-lab.mjs';

export function createRetentionLabDashboardRoutes(basePath = '/retention-lab') {
  const snapshot = buildRetentionLabSnapshot();
  return [
    { id: 'retention-lab.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'retention-lab.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'retention-lab.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
