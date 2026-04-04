import { buildPartnerSuccessSnapshot } from '../service-partner-success.mjs';
import { createPartnerSuccessFixtures } from '../fixtures-partner-success.mjs';

export function createPartnerSuccessPublicRoutes(basePath = '/public/partner-success') {
  const snapshot = buildPartnerSuccessSnapshot();
  const fixtures = createPartnerSuccessFixtures();
  return [
    { id: 'partner-success.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'partner-success.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'partner-success.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
