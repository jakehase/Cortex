import { buildDeliverabilityDossierSnapshot } from '../service-deliverability-dossier.mjs';
import { createDeliverabilityDossierFixtures } from '../fixtures-deliverability-dossier.mjs';

export function createDeliverabilityDossierPublicRoutes(basePath = '/public/deliverability-dossier') {
  const snapshot = buildDeliverabilityDossierSnapshot();
  const fixtures = createDeliverabilityDossierFixtures();
  return [
    { id: 'deliverability-dossier.public.summary', method: 'GET', path: basePath, focus: snapshot.workspace.focus },
    { id: 'deliverability-dossier.public.contacts', method: 'GET', path: basePath + '/contacts', contacts: fixtures.contacts },
    { id: 'deliverability-dossier.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}

