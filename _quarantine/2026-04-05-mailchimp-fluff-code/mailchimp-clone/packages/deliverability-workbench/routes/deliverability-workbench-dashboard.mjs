import { buildDeliverabilityWorkbenchSnapshot, createDeliverabilityWorkbenchRouteSummary } from '../service-deliverability-workbench.mjs';

export function createDeliverabilityWorkbenchDashboardRoutes(basePath = '/deliverability-workbench') {
  const snapshot = buildDeliverabilityWorkbenchSnapshot();
  return [
    { id: 'deliverability-workbench.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityWorkbenchRouteSummary(snapshot) },
    { id: 'deliverability-workbench.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-workbench.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

