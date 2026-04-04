import { buildSubscriptionIntelligenceSnapshot, createSubscriptionIntelligenceApiDocument } from '../service-subscription-intelligence.mjs';

export function createSubscriptionIntelligenceApiRoutes(basePath = '/api/subscription-intelligence') { const snapshot = buildSubscriptionIntelligenceSnapshot(); return [{ id: 'subscription-intelligence.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'subscription-intelligence.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'subscription-intelligence.api.document', method: 'GET', path: basePath + '/document', document: createSubscriptionIntelligenceApiDocument(snapshot) }]; }

