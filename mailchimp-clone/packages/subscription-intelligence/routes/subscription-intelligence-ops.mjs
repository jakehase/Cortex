import { buildSubscriptionIntelligenceSnapshot, createSubscriptionIntelligenceChecklist } from '../service-subscription-intelligence.mjs';

export function createSubscriptionIntelligenceOpsRoutes(basePath = '/ops/subscription-intelligence') { const snapshot = buildSubscriptionIntelligenceSnapshot(); return [{ id: 'subscription-intelligence.ops.health', method: 'GET', path: basePath + '/health', checklist: createSubscriptionIntelligenceChecklist(snapshot) }, { id: 'subscription-intelligence.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies }, { id: 'subscription-intelligence.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }]; }

