import { buildDeliverabilityFoundrySnapshot, createDeliverabilityFoundryRouteSummary } from '../service-deliverability-foundry.mjs';

export function createDeliverabilityFoundryDashboardRoutes(basePath = '/deliverability-foundry') {
  const snapshot = buildDeliverabilityFoundrySnapshot();
  return [
    { id: 'deliverability-foundry.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityFoundryRouteSummary(snapshot) },
    { id: 'deliverability-foundry.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-foundry.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

