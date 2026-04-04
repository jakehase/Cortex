import { buildSendTimeOptimizerSnapshot } from '../service-send-time-optimizer.mjs';

export function createSendTimeOptimizerDashboardRoutes(basePath = '/send-time-optimizer') {
  const snapshot = buildSendTimeOptimizerSnapshot();
  return [
    { id: 'send-time-optimizer.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'send-time-optimizer.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'send-time-optimizer.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
