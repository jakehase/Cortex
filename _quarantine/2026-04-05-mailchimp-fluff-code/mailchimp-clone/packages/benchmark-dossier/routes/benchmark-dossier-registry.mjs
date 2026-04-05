import { buildBenchmarkDossierSnapshot, createBenchmarkDossierRouteSummary } from '../service-benchmark-dossier.mjs';

export function createBenchmarkDossierRegistryRoutes(basePath = '/registry/benchmark-dossier') {
  const snapshot = buildBenchmarkDossierSnapshot();
  return [
    { id: 'benchmark-dossier.registry.summary', method: 'GET', path: basePath, summary: createBenchmarkDossierRouteSummary(snapshot) },
    { id: 'benchmark-dossier.registry.playbooks', method: 'GET', path: basePath + '/playbooks', playbooks: snapshot.playbooks },
    { id: 'benchmark-dossier.registry.decisions', method: 'GET', path: basePath + '/decisions', decisions: snapshot.decisions }
  ];
}

