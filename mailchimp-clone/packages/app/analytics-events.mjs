import { createId, nowIso } from './utils.mjs';
import { persistState } from './storage.mjs';

function ensureAnalyticsState(state) {
  state.db.analyticsEvents ||= [];
  state.db.analyticsPipelineRuns ||= [];
  state.db.reportingTelemetrySnapshots ||= [];
  state.db.telemetryLineageLedger ||= [];
  return state.db.analyticsEvents;
}

function eventSource(event = {}) {
  if (event.campaignId) return 'campaign';
  if (event.websiteId) return 'website';
  if (event.automationId) return 'automation';
  if (event.formId) return 'lead_capture';
  if (event.orderId || event.revenueAttributionId) return 'commerce';
  return event.source || 'workspace';
}

export function normalizeTelemetryEvent(event = {}) {
  const createdAt = event.createdAt || nowIso();
  const source = eventSource(event);
  return {
    id: event.id || createId('evt'),
    createdAt,
    workspaceId: event.workspaceId || 'workspace_unknown',
    type: event.type || 'workspace_event',
    source,
    metricValue: Number(event.count ?? event.metricValue ?? event.recipientTotal ?? 1),
    lineage: {
      source,
      campaignId: event.campaignId || null,
      automationId: event.automationId || null,
      websiteId: event.websiteId || null,
      pageId: event.pageId || null,
      formId: event.formId || null,
      orderId: event.orderId || null,
      ingestionMode: event.ingestionMode || 'local_pipeline',
      observedAt: createdAt
    },
    ...event
  };
}

export function recordAnalyticsEvent(state, event) {
  const events = ensureAnalyticsState(state);
  const normalized = normalizeTelemetryEvent(event);
  events.unshift(normalized);
  const pipelineRun = {
    id: createId('aprun'),
    workspaceId: normalized.workspaceId,
    eventId: normalized.id,
    eventType: normalized.type,
    source: normalized.source,
    status: 'accepted',
    rowCount: 1,
    metricValue: normalized.metricValue,
    createdAt: nowIso(),
    lineage: normalized.lineage
  };
  state.db.analyticsPipelineRuns.unshift(pipelineRun);
  state.db.telemetryLineageLedger.unshift({
    id: createId('tline'),
    workspaceId: normalized.workspaceId,
    eventId: normalized.id,
    pipelineRunId: pipelineRun.id,
    source: normalized.source,
    lineage: normalized.lineage,
    createdAt: nowIso()
  });
  return normalized;
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

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item) || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function sumBy(items, keyFn, valueFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item) || 'unknown';
    acc[key] = (acc[key] || 0) + Number(valueFn(item) || 0);
    return acc;
  }, {});
}

export function buildTelemetryPipelineSnapshot(state, workspaceId, options = {}) {
  ensureAnalyticsState(state);
  const events = state.db.analyticsEvents.filter((entry) => entry.workspaceId === workspaceId);
  const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId);
  const automations = state.db.automations.filter((entry) => entry.workspaceId === workspaceId);
  const websites = (state.db.websites || []).filter((entry) => entry.workspaceId === workspaceId);
  const orders = (state.db.commerceOrders || []).filter((entry) => entry.workspaceId === workspaceId);
  const pipelineRuns = state.db.analyticsPipelineRuns.filter((entry) => entry.workspaceId === workspaceId);
  const lineageRows = state.db.telemetryLineageLedger.filter((entry) => entry.workspaceId === workspaceId);
  const sourceCounts = countBy(events, (entry) => entry.source || eventSource(entry));
  const eventTypeCounts = countBy(events, (entry) => entry.type);
  const metricTotalsByType = sumBy(events, (entry) => entry.type, (entry) => entry.metricValue || entry.count || 1);
  const campaignRollups = campaigns.map((campaign) => {
    const campaignEvents = events.filter((entry) => entry.campaignId === campaign.id);
    const sent = campaign.report?.history?.[0]?.recipients || campaignEvents.find((entry) => entry.recipientTotal)?.recipientTotal || 0;
    const opens = campaignEvents.filter((entry) => entry.type === 'campaign_open').length + Number(campaign.report?.opens || 0);
    const clicks = campaignEvents.filter((entry) => entry.type === 'campaign_click').length + Number(campaign.report?.clicks || 0);
    return {
      campaignId: campaign.id,
      name: campaign.name,
      status: campaign.status,
      sent,
      opens,
      clicks,
      openRate: sent ? Number(((opens / sent) * 100).toFixed(2)) : 0,
      clickRate: sent ? Number(((clicks / sent) * 100).toFixed(2)) : 0,
      eventCount: campaignEvents.length,
      lastEventAt: campaignEvents[0]?.createdAt || campaign.report?.history?.[0]?.at || null
    };
  });
  const websiteRollups = websites.map((website) => {
    const websiteEvents = events.filter((entry) => entry.websiteId === website.id);
    return {
      websiteId: website.id,
      name: website.name,
      views: websiteEvents.filter((entry) => entry.type === 'website_view').length,
      signups: websiteEvents.filter((entry) => entry.type === 'website_signup').length,
      ctaClicks: websiteEvents.filter((entry) => entry.type === 'website_cta').length,
      eventCount: websiteEvents.length
    };
  });
  const revenueTotal = orders.reduce((sum, order) => sum + Number(order.total || order.amount || 0), 0);
  return {
    id: createId('telroll'),
    workspaceId,
    generatedAt: options.now || nowIso(),
    eventCount: events.length,
    pipelineRunCount: pipelineRuns.length,
    lineageRowCount: lineageRows.length,
    sourceCounts,
    eventTypeCounts,
    metricTotalsByType,
    campaignRollups,
    websiteRollups,
    automationRollups: automations.map((automation) => ({
      automationId: automation.id,
      name: automation.name,
      status: automation.status,
      reportHistoryEvents: (automation.report?.history || []).length,
      runs: state.db.automationRuns.filter((run) => run.automationId === automation.id).length
    })),
    attribution: {
      revenueTotal,
      orderCount: orders.length,
      campaignAttributedOrders: orders.filter((order) => order.campaignId).length,
      automationAttributedOrders: orders.filter((order) => order.automationId).length
    },
    lineagePreview: lineageRows.slice(0, 10).map((row) => ({ eventId: row.eventId, source: row.source, observedAt: row.lineage?.observedAt, pipelineRunId: row.pipelineRunId })),
    freshness: {
      latestEventAt: events[0]?.createdAt || null,
      latestPipelineRunAt: pipelineRuns[0]?.createdAt || null,
      status: events.length && pipelineRuns.length ? 'telemetry_pipeline_active' : 'waiting_for_telemetry'
    }
  };
}

export function refreshReportingTelemetryPipeline(state, actor) {
  const snapshot = buildTelemetryPipelineSnapshot(state, actor.workspace.id);
  state.db.reportingTelemetrySnapshots.unshift(snapshot);
  state.db.reportingTelemetrySnapshots = state.db.reportingTelemetrySnapshots.slice(0, 50);
  state.db.auditEvents ||= [];
  state.db.auditEvents.unshift({ id: createId('audit'), workspaceId: actor.workspace.id, userId: actor.user.id, action: 'reporting-telemetry-refresh', detail: `Refreshed reporting telemetry snapshot ${snapshot.id}`, createdAt: nowIso() });
  persistState(state);
  return snapshot;
}
