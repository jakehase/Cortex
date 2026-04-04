import { buildPartnerCertificationSnapshot } from '../service-partner-certification.mjs';
import { createPartnerCertificationFixtures } from '../fixtures-partner-certification.mjs';

export function createPartnerCertificationPublicRoutes(basePath = '/public/partner-certification') { const snapshot = buildPartnerCertificationSnapshot(); const fixtures = createPartnerCertificationFixtures(); return [{ id: 'partner-certification.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'partner-certification.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'partner-certification.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

