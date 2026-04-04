import { buildCampaignDossierSnapshot } from '../service-campaign-dossier.mjs';
import { createCampaignDossierFixtures } from '../fixtures-campaign-dossier.mjs';

export function createCampaignDossierPublicRoutes(basePath = '/public/campaign-dossier') {
  const snapshot = buildCampaignDossierSnapshot();
  const fixtures = createCampaignDossierFixtures();
  return [
    { id: 'campaign-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'campaign-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'campaign-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

