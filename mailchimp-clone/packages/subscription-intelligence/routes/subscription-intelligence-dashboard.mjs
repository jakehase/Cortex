import { buildSubscriptionIntelligenceSnapshot } from '../service-subscription-intelligence.mjs';

export function createSubscriptionIntelligenceDashboardRoutes(basePath = '/subscription-intelligence') { const snapshot = buildSubscriptionIntelligenceSnapshot(); return [{ id: 'subscription-intelligence.overview', method: 'GET', path: basePath, summary: snapshot.summary }, { id: 'subscription-intelligence.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs }, { id: 'subscription-intelligence.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }]; }

