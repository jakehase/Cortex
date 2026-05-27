import { buildPredictiveSegmentsSnapshot } from '../predictive-segments/index.mjs';
import { buildSendTimeOptimizerSnapshot } from '../send-time-optimizer/index.mjs';

export function scoreContactPredictiveFit(contact = {}) {
  let score = contact.status === 'subscribed' ? 38 : 10;
  score += Math.min(18, (contact.tags || []).length * 4);
  score += Math.min(16, (contact.interests || []).length * 4);
  score += Math.min(12, (contact.activity || []).length * 3);
  if (contact.phone) score += 6;
  if ((contact.notes || '').toLowerCase().includes('vip')) score += 8;
  return Math.max(0, Math.min(100, score));
}

export function buildPredictiveWorkspace(state, workspaceId, audienceId = '') {
  const contacts = state.db.contacts.filter((entry) => entry.workspaceId === workspaceId).filter((entry) => !audienceId || entry.audienceId === audienceId).map((contact) => {
    const predictiveScore = scoreContactPredictiveFit(contact);
    return { ...contact, predictiveScore, lifecycleTier: predictiveScore >= 75 ? 'high_intent' : predictiveScore >= 50 ? 'warming' : 'monitor' };
  }).sort((a, b) => b.predictiveScore - a.predictiveScore);
  return { contacts, highIntent: contacts.filter((entry) => entry.predictiveScore >= 75).length, recommendations: [{ id: 'predictive-rec-1', label: 'Likely next purchasers', criteria: 'predictiveScore >= 75' }, { id: 'predictive-rec-2', label: 'Re-engage with SMS fallback', criteria: 'predictiveScore between 50 and 74' }, { id: 'predictive-rec-3', label: 'Frequency cap / fatigue watch', criteria: 'predictiveScore < 50 and recent activity low' }], sendTime: buildSendTimeOptimizerSnapshot(), predictiveSegments: buildPredictiveSegmentsSnapshot() };
}

export function buildPredictiveFeatureStore(state = { db: {} }, workspaceId = '', options = {}) {
  const workspace = buildPredictiveWorkspace(state, workspaceId, options.audienceId || '');
  const campaigns = Array.isArray(state.db?.campaigns) ? state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId) : [];
  const automations = Array.isArray(state.db?.automations) ? state.db.automations.filter((entry) => entry.workspaceId === workspaceId) : [];
  const vectors = workspace.contacts.map((contact) => ({ contactId: contact.id, email: contact.email, audienceId: contact.audienceId || '', score: contact.predictiveScore, lifecycleTier: contact.lifecycleTier, tagCount: (contact.tags || []).length, interestCount: (contact.interests || []).length, activityCount: (contact.activity || []).length, hasPhone: Boolean(contact.phone), status: contact.status || 'unknown' }));
  const averageScore = vectors.length ? Number((vectors.reduce((sum, vector) => sum + Number(vector.score || 0), 0) / vectors.length).toFixed(1)) : 0;
  return { workspaceId, featureColumns: ['predictiveScore', 'lifecycleTier', 'tagCount', 'interestCount', 'activityCount', 'hasPhone', 'status'], vectors, aggregate: { goal: options.goal || 'increase audience engagement', totalContacts: vectors.length, highIntentContacts: vectors.filter((entry) => entry.lifecycleTier === 'high_intent').length, warmingContacts: vectors.filter((entry) => entry.lifecycleTier === 'warming').length, averageScore, campaignCount: campaigns.length, automationCount: automations.length }, sendTime: workspace.sendTime, predictiveSegments: workspace.predictiveSegments };
}

export function rankPredictiveNextActions(state = { db: {} }, workspaceId = '', options = {}) {
  const featureStore = buildPredictiveFeatureStore(state, workspaceId, options);
  const campaigns = Array.isArray(state.db?.campaigns) ? state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId) : [];
  const automations = Array.isArray(state.db?.automations) ? state.db.automations.filter((entry) => entry.workspaceId === workspaceId) : [];
  const recommendations = [];
  if (campaigns.length) recommendations.push({ category: 'campaign_optimization', targetId: campaigns[0].id, label: 'Optimize ' + (campaigns[0].name || 'campaign') + ' for ' + (options.goal || 'engagement'), confidence: 0.88, rationale: 'Campaign and audience feature signals are available for content optimization.', payload: { campaignId: campaigns[0].id, goal: options.goal || featureStore.aggregate.goal } });
  for (const vector of featureStore.vectors.slice(0, 3)) recommendations.push({ category: 'audience_prioritization', targetId: vector.contactId, label: vector.lifecycleTier + ' contact follow-up', confidence: Number((Math.max(0, Math.min(100, vector.score)) / 100).toFixed(2)), rationale: 'Predictive score ' + vector.score + ' with ' + vector.activityCount + ' recent activity signals.', payload: { contactId: vector.contactId, lifecycleTier: vector.lifecycleTier, preferredChannel: vector.hasPhone ? 'sms_plus_email' : 'email' } });
  if (automations.length) recommendations.push({ category: 'journey_optimization', targetId: automations[0].id, label: 'Tune journey timing and channel mix', confidence: 0.84, rationale: 'Automation history is present, so journey timing can be optimized.', payload: { automationId: automations[0].id, goal: options.goal || featureStore.aggregate.goal } });
  if (!recommendations.length) recommendations.push({ category: 'signal_collection', targetId: workspaceId, label: 'Collect campaign and audience signals', confidence: 0.62, rationale: 'Predictive recommendations need at least campaign, contact, or automation activity.', payload: { workspaceId } });
  return { featureStore, recommendations };
}
