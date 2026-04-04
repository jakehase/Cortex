import { buildPartnerSuccessSnapshot } from '../service-partner-success.mjs';

export function createPartnerSuccessDashboardRoutes(basePath = '/partner-success') {
  const snapshot = buildPartnerSuccessSnapshot();
  return [
    { id: 'partner-success.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'partner-success.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'partner-success.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
