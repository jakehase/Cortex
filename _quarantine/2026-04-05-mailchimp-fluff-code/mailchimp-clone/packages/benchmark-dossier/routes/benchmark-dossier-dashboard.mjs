import { buildBenchmarkDossierSnapshot, createBenchmarkDossierRouteSummary } from '../service-benchmark-dossier.mjs';

export function createBenchmarkDossierDashboardRoutes(basePath = '/benchmark-dossier') {
  const snapshot = buildBenchmarkDossierSnapshot();
  return [
    { id: 'benchmark-dossier.dashboard.overview', method: 'GET', path: basePath, summary: createBenchmarkDossierRouteSummary(snapshot) },
    { id: 'benchmark-dossier.dashboard.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'benchmark-dossier.dashboard.coverage', method: 'GET', path: basePath + '/coverage', coverage: snapshot.coverage }
  ];
}

