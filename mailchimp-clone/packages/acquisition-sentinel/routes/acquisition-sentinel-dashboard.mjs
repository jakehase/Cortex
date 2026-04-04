import { buildAcquisitionSentinelSnapshot, createAcquisitionSentinelRouteSummary } from '../service-acquisition-sentinel.mjs';

export function createAcquisitionSentinelDashboardRoutes(basePath = '/acquisition-sentinel') {
  const snapshot = buildAcquisitionSentinelSnapshot();
  return [
    { id: 'acquisition-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createAcquisitionSentinelRouteSummary(snapshot) },
    { id: 'acquisition-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'acquisition-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

