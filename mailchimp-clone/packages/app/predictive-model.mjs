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

function lifecycleTierFor(score) {
  return score >= 75 ? 'high_intent' : score >= 50 ? 'warming' : 'monitor';
}

function recommendedWindowFor(contact = {}, score = 0) {
  const activityText = (contact.activity || []).join(' ').toLowerCase();
  if (activityText.includes('evening')) return '17:00-19:00 local';
  if (activityText.includes('morning') || score >= 75) return '09:00-11:00 local';
  return '13:00-15:00 local';
}

export function buildContactFeatureVector(contact = {}) {
  const predictiveScore = scoreContactPredictiveFit(contact);
  const lifecycleTier = lifecycleTierFor(predictiveScore);
  return {
    contactId: contact.id,
    email: contact.email,
    predictiveScore,
    lifecycleTier,
    tagCount: (contact.tags || []).length,
    interestCount: (contact.interests || []).length,
    activityCount: (contact.activity || []).length,
    hasPhone: Boolean(contact.phone),
    status: contact.status || 'unknown',
    recommendedWindow: recommendedWindowFor(contact, predictiveScore),
    evidence: [
      contact.status === 'subscribed' ? 'subscribed contact' : 'non-subscribed status',
      `${(contact.tags || []).length} tags`,
      `${(contact.interests || []).length} interests`,
      `${(contact.activity || []).length} activity signals`,
      contact.phone ? 'sms-capable contact' : 'email-only contact'
    ]
  };
}

export function buildPredictiveFeatureStore(state, workspaceId, audienceId = '') {
  const contacts = (state.db.contacts || [])
    .filter((entry) => entry.workspaceId === workspaceId)
    .filter((entry) => !audienceId || entry.audienceId === audienceId)
    .map((contact) => ({ ...contact, featureVector: buildContactFeatureVector(contact) }))
    .sort((a, b) => b.featureVector.predictiveScore - a.featureVector.predictiveScore);
  const vectors = contacts.map((contact) => contact.featureVector);
  const highIntent = vectors.filter((entry) => entry.lifecycleTier === 'high_intent').length;
  const warming = vectors.filter((entry) => entry.lifecycleTier === 'warming').length;
  const monitor = vectors.filter((entry) => entry.lifecycleTier === 'monitor').length;
  const bestSendWindow = vectors.find((entry) => entry.recommendedWindow)?.recommendedWindow || '09:00-11:00 local';
  return {
    modelVersion: 'mailclone-predictive-features-v2',
    workspaceId,
    audienceId,
    generatedFrom: ['contacts', 'tags', 'interests', 'activity', 'channel consent'],
    featureColumns: ['subscription_status', 'tag_count', 'interest_count', 'activity_count', 'phone_capability', 'notes_vip_signal'],
    contacts: contacts.map((contact) => ({ ...contact, predictiveScore: contact.featureVector.predictiveScore, lifecycleTier: contact.featureVector.lifecycleTier })),
    vectors,
    aggregate: {
      totalContacts: vectors.length,
      highIntent,
      warming,
      monitor,
      bestSendWindow,
      averageScore: vectors.length ? Number((vectors.reduce((sum, entry) => sum + entry.predictiveScore, 0) / vectors.length).toFixed(1)) : 0
    }
  };
}

export function rankPredictiveNextActions(state, workspaceId, options = {}) {
  const featureStore = buildPredictiveFeatureStore(state, workspaceId, options.audienceId || '');
  const campaigns = (state.db.campaigns || []).filter((entry) => entry.workspaceId === workspaceId);
  const automations = (state.db.automations || []).filter((entry) => entry.workspaceId === workspaceId);
  const targetCampaign = campaigns.find((entry) => entry.id === options.campaignId) || campaigns[0] || null;
  const targetAutomation = automations.find((entry) => entry.id === options.automationId) || automations[0] || null;
  const topVector = featureStore.vectors[0] || null;
  const totalContacts = featureStore.aggregate.totalContacts;
  const highIntent = featureStore.aggregate.highIntent;
  const campaignConfidence = Math.min(0.96, Number((0.68 + (highIntent * 0.04) + (totalContacts * 0.01)).toFixed(2)));
  const recommendations = [];
  if (targetCampaign) {
    recommendations.push({
      category: 'campaign_optimization',
      targetType: 'campaign',
      targetId: targetCampaign.id,
      label: `Optimize ${targetCampaign.name} for predictive intent`,
      action: 'apply_campaign_optimization',
      confidence: campaignConfidence,
      rationale: `Campaign has ${totalContacts} scored contacts, ${highIntent} high-intent contacts, and a best send window of ${featureStore.aggregate.bestSendWindow}.`,
      evidence: ['campaign audience selection', 'predictive feature store', 'lifecycle tier distribution'],
      payload: {
        sendTimeWindow: featureStore.aggregate.bestSendWindow,
        predictiveSegment: highIntent > 0 ? 'High-intent lifecycle contacts' : 'Warming lifecycle contacts',
        fatigueGuardrail: '2 messages / 7 days',
        productRecommendation: options.productRecommendation || 'Personalized offer bundle'
      },
      featureRefs: featureStore.vectors.slice(0, 5).map((entry) => entry.contactId)
    });
  }
  if (topVector) {
    recommendations.push({
      category: 'audience_prioritization',
      targetType: 'contact',
      targetId: topVector.contactId,
      label: `Prioritize ${topVector.email}`,
      action: 'prioritize_contact_lifecycle',
      confidence: Number((0.55 + (topVector.predictiveScore / 220)).toFixed(2)),
      rationale: `Top contact is ${topVector.lifecycleTier} with score ${topVector.predictiveScore} and ${topVector.activityCount} activity signals.`,
      evidence: topVector.evidence,
      payload: { lifecycleStage: topVector.lifecycleTier, sendTimeWindow: topVector.recommendedWindow, channel: topVector.hasPhone ? 'sms_plus_email' : 'email' },
      featureRefs: [topVector.contactId]
    });
  }
  if (targetAutomation) {
    recommendations.push({
      category: 'journey_guidance',
      targetType: 'automation',
      targetId: targetAutomation.id,
      label: `Add predictive branch to ${targetAutomation.name}`,
      action: 'add_predictive_journey_branch',
      confidence: Number((0.66 + Math.min(0.18, featureStore.aggregate.warming * 0.03)).toFixed(2)),
      rationale: `Use lifecycle tiers to branch high-intent and warming contacts without changing the durable journey save path.`,
      evidence: ['automation state', 'lifecycle tier distribution', 'contact feature vectors'],
      payload: { branchCondition: 'predictiveScore >= 75', warmingPath: 'send proof email', monitorPath: 'hold frequency cap' },
      featureRefs: featureStore.vectors.slice(0, 3).map((entry) => entry.contactId)
    });
  }
  return { featureStore, recommendations };
}

export function buildPredictiveWorkspace(state, workspaceId, audienceId = '') {
  const featureStore = buildPredictiveFeatureStore(state, workspaceId, audienceId);
  const contacts = featureStore.contacts;
  return { contacts, featureStore, highIntent: featureStore.aggregate.highIntent, recommendations: [{ id: 'predictive-rec-1', label: 'Likely next purchasers', criteria: 'predictiveScore >= 75' }, { id: 'predictive-rec-2', label: 'Re-engage with SMS fallback', criteria: 'predictiveScore between 50 and 74' }, { id: 'predictive-rec-3', label: 'Frequency cap / fatigue watch', criteria: 'predictiveScore < 50 and recent activity low' }], sendTime: buildSendTimeOptimizerSnapshot(), predictiveSegments: buildPredictiveSegmentsSnapshot() };
}
