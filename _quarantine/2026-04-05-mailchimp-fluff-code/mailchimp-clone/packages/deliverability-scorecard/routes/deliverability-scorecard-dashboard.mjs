import { buildDeliverabilityScorecardSnapshot, createDeliverabilityScorecardRouteSummary } from '../service-deliverability-scorecard.mjs';

export function createDeliverabilityScorecardDashboardRoutes(basePath = '/deliverability-scorecard') {
  const snapshot = buildDeliverabilityScorecardSnapshot();
  return [
    { id: 'deliverability-scorecard.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityScorecardRouteSummary(snapshot) },
    { id: 'deliverability-scorecard.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-scorecard.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

