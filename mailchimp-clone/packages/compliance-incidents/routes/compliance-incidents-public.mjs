import { buildComplianceIncidentsSnapshot } from '../service-compliance-incidents.mjs';
import { createComplianceIncidentsFixtures } from '../fixtures-compliance-incidents.mjs';

export function createComplianceIncidentsPublicRoutes(basePath = '/public/compliance-incidents') { const snapshot = buildComplianceIncidentsSnapshot(); const fixtures = createComplianceIncidentsFixtures(); return [{ id: 'compliance-incidents.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'compliance-incidents.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'compliance-incidents.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

