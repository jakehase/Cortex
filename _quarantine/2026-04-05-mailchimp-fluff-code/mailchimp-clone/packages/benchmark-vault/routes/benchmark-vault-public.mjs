import { buildBenchmarkVaultSnapshot } from '../service-benchmark-vault.mjs';
import { createBenchmarkVaultFixtures } from '../fixtures-benchmark-vault.mjs';

export function createBenchmarkVaultPublicRoutes(basePath = '/public/benchmark-vault') {
  const snapshot = buildBenchmarkVaultSnapshot();
  const fixtures = createBenchmarkVaultFixtures();
  return [
    { id: 'benchmark-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'benchmark-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'benchmark-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

