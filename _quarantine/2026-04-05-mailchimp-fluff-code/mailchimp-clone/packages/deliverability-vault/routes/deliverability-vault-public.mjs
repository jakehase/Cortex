import { buildDeliverabilityVaultSnapshot } from '../service-deliverability-vault.mjs';
import { createDeliverabilityVaultFixtures } from '../fixtures-deliverability-vault.mjs';

export function createDeliverabilityVaultPublicRoutes(basePath = '/public/deliverability-vault') {
  const snapshot = buildDeliverabilityVaultSnapshot();
  const fixtures = createDeliverabilityVaultFixtures();
  return [
    { id: 'deliverability-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

