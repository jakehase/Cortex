import { buildEcommerceInsightsSnapshot } from '../service-ecommerce-insights.mjs';
import { createEcommerceInsightsFixtures } from '../fixtures-ecommerce-insights.mjs';

export function createEcommerceInsightsPublicRoutes(basePath = '/public/ecommerce-insights') { const snapshot = buildEcommerceInsightsSnapshot(); const fixtures = createEcommerceInsightsFixtures(); return [{ id: 'ecommerce-insights.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'ecommerce-insights.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'ecommerce-insights.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

