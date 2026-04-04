import { buildDeliverabilityAtlasSnapshot, createDeliverabilityAtlasRouteSummary } from '../service-deliverability-atlas.mjs';

export function createDeliverabilityAtlasDashboardRoutes(basePath = '/deliverability-atlas') {
  const snapshot = buildDeliverabilityAtlasSnapshot();
  return [
    { id: 'deliverability-atlas.dashboard.overview', method: 'GET', path: basePath, summary: createDeliverabilityAtlasRouteSummary(snapshot) },
    { id: 'deliverability-atlas.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'deliverability-atlas.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

