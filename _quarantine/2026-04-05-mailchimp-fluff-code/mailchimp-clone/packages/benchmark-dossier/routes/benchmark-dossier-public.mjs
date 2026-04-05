import { buildBenchmarkDossierSnapshot } from '../service-benchmark-dossier.mjs';
import { createBenchmarkDossierFixtures } from '../fixtures-benchmark-dossier.mjs';

export function createBenchmarkDossierPublicRoutes(basePath = '/public/benchmark-dossier') {
  const snapshot = buildBenchmarkDossierSnapshot();
  const fixtures = createBenchmarkDossierFixtures();
  return [
    { id: 'benchmark-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

