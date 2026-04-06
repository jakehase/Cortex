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
