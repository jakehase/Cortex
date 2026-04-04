import { buildDeliverabilityLabsSnapshot } from '../service-deliverability-labs.mjs';
import { createDeliverabilityLabsFixtures } from '../fixtures-deliverability-labs.mjs';

export function createDeliverabilityLabsPublicRoutes(basePath = '/public/deliverability-labs') { const snapshot = buildDeliverabilityLabsSnapshot(); const fixtures = createDeliverabilityLabsFixtures(); return [{ id: 'deliverability-labs.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'deliverability-labs.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'deliverability-labs.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }
