import { buildOpsObservabilitySnapshot } from '../service-ops-observability.mjs';

export function createOpsObservabilityDashboardRoutes(basePath = '/ops-observability') {
  const snapshot = buildOpsObservabilitySnapshot();
  return [
    { id: 'ops-observability.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'ops-observability.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'ops-observability.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
