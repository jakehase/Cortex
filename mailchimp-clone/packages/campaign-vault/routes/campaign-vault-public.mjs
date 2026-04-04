import { buildCampaignVaultSnapshot } from '../service-campaign-vault.mjs';
import { createCampaignVaultFixtures } from '../fixtures-campaign-vault.mjs';

export function createCampaignVaultPublicRoutes(basePath = '/public/campaign-vault') {
  const snapshot = buildCampaignVaultSnapshot();
  const fixtures = createCampaignVaultFixtures();
  return [
    { id: 'campaign-vault.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-vault.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-vault.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

