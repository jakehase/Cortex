import { nowIso } from './utils.mjs';

function ensureAnalyticsState(state) {
  state.db.analyticsEvents ||= [];
  return state.db.analyticsEvents;
}

export function recordAnalyticsEvent(state, event) {
  ensureAnalyticsState(state).unshift({
    id: event.id || `evt_${Math.random().toString(16).slice(2)}`,
    createdAt: nowIso(),
    ...event
  });
}

export function campaignReportFromEvents(state, campaignId) {
  const events = ensureAnalyticsState(state).filter((entry) => entry.campaignId === campaignId);
  const opens = events.filter((entry) => entry.type === 'campaign_open').length;
  const clicks = events.filter((entry) => entry.type === 'campaign_click').length;
  const bounces = events.filter((entry) => entry.type === 'campaign_bounce').length;
  const unsubscribes = events.filter((entry) => entry.type === 'campaign_unsubscribe').length;
  return {
    opens,
    clicks,
    bounces,
    unsubscribes,
    history: events.map((entry) => ({ at: entry.createdAt, event: entry.type, recipients: entry.recipientTotal || 0 }))
  };
}

export function rebuildWebsiteAnalytics(state, websiteId, pageId) {
  const events = ensureAnalyticsState(state).filter((entry) => entry.websiteId === websiteId);
  const byPage = {};
  for (const event of events) {
    byPage[event.pageId] ||= { views: 0, signups: 0, ctaClicks: 0 };
    if (event.type === 'website_view') byPage[event.pageId].views += 1;
    if (event.type === 'website_cta') byPage[event.pageId].ctaClicks += 1;
    if (event.type === 'website_signup') byPage[event.pageId].signups += 1;
  }
  const aggregate = {
    views: events.filter((entry) => entry.type === 'website_view').length,
    signups: events.filter((entry) => entry.type === 'website_signup').length,
    ctaClicks: events.filter((entry) => entry.type === 'website_cta').length,
    lastReferrer: [...events].reverse().find((entry) => entry.referrer)?.referrer || '',
    byPage
  };
  return { website: aggregate, page: byPage[pageId] || { views: 0, signups: 0, ctaClicks: 0 } };
}
