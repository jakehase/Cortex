import { buildCollaborationVaultSnapshot } from '../service-collaboration-vault.mjs';
import { createCollaborationVaultFixtures } from '../fixtures-collaboration-vault.mjs';

export function createCollaborationVaultPublicRoutes(basePath = '/public/collaboration-vault') {
  const snapshot = buildCollaborationVaultSnapshot();
  const fixtures = createCollaborationVaultFixtures();
  return [
    { id: 'collaboration-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'collaboration-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'collaboration-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

