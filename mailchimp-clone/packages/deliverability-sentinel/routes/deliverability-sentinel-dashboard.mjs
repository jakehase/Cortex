import { buildDeliverabilitySentinelSnapshot, createDeliverabilitySentinelRouteSummary } from '../service-deliverability-sentinel.mjs';

export function createDeliverabilitySentinelDashboardRoutes(basePath = '/deliverability-sentinel') {
  const snapshot = buildDeliverabilitySentinelSnapshot();
  return [
    { id: 'deliverability-sentinel.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilitySentinelRouteSummary(snapshot) },
    { id: 'deliverability-sentinel.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-sentinel.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

