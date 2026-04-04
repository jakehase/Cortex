import { buildAudienceSyncSnapshot } from '../service-audience-sync.mjs';

export function createAudienceSyncDashboardRoutes(basePath = '/audience-sync') {
  const snapshot = buildAudienceSyncSnapshot();
  return [
    { id: 'audience-sync.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'audience-sync.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'audience-sync.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
