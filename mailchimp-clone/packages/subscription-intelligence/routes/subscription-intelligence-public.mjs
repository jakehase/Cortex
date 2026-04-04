import { buildSubscriptionIntelligenceSnapshot } from '../service-subscription-intelligence.mjs';
import { createSubscriptionIntelligenceFixtures } from '../fixtures-subscription-intelligence.mjs';

export function createSubscriptionIntelligencePublicRoutes(basePath = '/public/subscription-intelligence') { const snapshot = buildSubscriptionIntelligenceSnapshot(); const fixtures = createSubscriptionIntelligenceFixtures(); return [{ id: 'subscription-intelligence.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus }, { id: 'subscription-intelligence.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts }, { id: 'subscription-intelligence.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }]; }

