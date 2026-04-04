import { buildDeliverabilityNotebookSnapshot, createDeliverabilityNotebookRouteSummary } from '../service-deliverability-notebook.mjs';

export function createDeliverabilityNotebookDashboardRoutes(basePath = '/deliverability-notebook') {
  const snapshot = buildDeliverabilityNotebookSnapshot();
  return [
    { id: 'deliverability-notebook.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityNotebookRouteSummary(snapshot) },
    { id: 'deliverability-notebook.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-notebook.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

