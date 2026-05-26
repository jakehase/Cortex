import { createHmac } from 'node:crypto';
import { createAudience, createWorkspace, PLAN_CATALOG, persistState, writeExport, writeUpload } from './storage.mjs';
import { createId, csvSplit, formArray, hashPassword, normalizeDomainName, nowIso, parseCookies } from './utils.mjs';
import { createSession, getSessionFromRequest } from './security.mjs';

export function planFor(workspace) {
  return PLAN_CATALOG.find((plan) => plan.id === workspace.planId) || PLAN_CATALOG[0];
}

export function hasFeature(workspace, key) {
  return Boolean(planFor(workspace).features[key]) || ['automations', 'forms', 'landingPages', 'reports', 'webhooks', 'apiAccess', 'integrationsMarketplace', 'commerceInsights', 'approvals', 'complianceCenter', 'contentStudioTemplates'].includes(key);
}

export const DEVELOPER_WEBHOOKS_API_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'developer_webhooks_api_runtime_layer',
  label: 'Developer API and webhook runtime contract',
  controls: [
    'scoped_api_key_lifecycle',
    'api_request_audit_ledger',
    'webhook_subscription_lifecycle',
    'signed_webhook_delivery',
    'webhook_delivery_replay',
    'developer_runtime_snapshot_api'
  ],
  evidenceContract: [
    'scoped_keys_include_permissions_environment_and_expiry',
    'api_requests_record_key_scope_actor_route_and_status',
    'webhook_subscriptions_track_create_pause_resume_and_replay_lifecycle',
    'deliveries_include_hmac_signature_headers_and_replay_lineage',
    'runtime_snapshot_persists_keys_subscriptions_audits_and_delivery_health'
  ]
});

const DEFAULT_DEVELOPER_API_SCOPES = ['contacts:read', 'contacts:write', 'campaigns:read', 'webhooks:write'];

function ensureDeveloperRuntimeCollections(state) {
  state.db.apiKeys ||= [];
  state.db.webhooks ||= [];
  state.db.webhookDeliveries ||= [];
  state.db.developerRuntimeSnapshots ||= [];
  state.db.developerApiRequestAudits ||= [];
  state.db.webhookSubscriptionEvents ||= [];
}

function normalizeDeveloperScopes(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const scopes = raw.map((entry) => String(entry || '').trim()).filter(Boolean);
  return Array.from(new Set(scopes.length ? scopes : DEFAULT_DEVELOPER_API_SCOPES));
}

function tokenPreview(token = '') {
  const value = String(token || '');
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function signingSecretFor(workspaceId, hookId) {
  return `whsec_${String(workspaceId || 'workspace').slice(-6)}_${String(hookId || createId('hook')).slice(-6)}`;
}

function signedDeliveryFor(hook, eventType, payload = {}, options = {}) {
  const createdAt = nowIso();
  const secret = hook.signingSecret || signingSecretFor(hook.workspaceId, hook.id);
  const body = { type: eventType, workspaceId: hook.workspaceId, data: payload?.data || payload, replayOfDeliveryId: options.replayOfDeliveryId || null };
  const signatureBase = `${createdAt}.${JSON.stringify(body)}`;
  const signature = createHmac('sha256', secret).update(signatureBase).digest('hex');
  return {
    id: createId('whd'),
    workspaceId: hook.workspaceId,
    webhookId: hook.id,
    subscriptionId: hook.id,
    eventType,
    targetUrl: hook.targetUrl,
    payload: body,
    status: options.status || 'delivered',
    attempt: Number(options.attempt || 1),
    signed: true,
    signatureAlgorithm: 'hmac-sha256',
    signature,
    signatureBase,
    headers: {
      'X-Mailclone-Event': eventType,
      'X-Mailclone-Timestamp': createdAt,
      'X-Mailclone-Signature': `sha256=${signature}`,
      'X-Mailclone-Delivery': options.replayOfDeliveryId ? 'replay' : 'initial'
    },
    replayOfDeliveryId: options.replayOfDeliveryId || null,
    createdAt
  };
}

export function recordWebhookSubscriptionLifecycle(state, actor, hook, action, detail = '') {
  ensureDeveloperRuntimeCollections(state);
  const workspaceId = hook?.workspaceId || actor?.workspace?.id || actor?.workspaceId;
  const event = {
    id: createId('whsubevt'),
    workspaceId,
    webhookId: hook?.id || null,
    action,
    status: hook?.status || 'unknown',
    events: Array.isArray(hook?.events) ? [...hook.events] : [],
    targetUrl: hook?.targetUrl || '',
    detail,
    actorUserId: actor?.user?.id || actor?.userId || null,
    createdAt: nowIso()
  };
  state.db.webhookSubscriptionEvents.unshift(event);
  return event;
}

export function createDeveloperScopedApiKey(state, actor, body = {}) {
  ensureDeveloperRuntimeCollections(state);
  const key = {
    id: createId('apikey'),
    workspaceId: actor.workspace.id,
    label: body.label || 'Developer integration key',
    token: createId('key'),
    tokenPreview: '',
    createdBy: actor.user.id,
    createdAt: nowIso(),
    revokedAt: null,
    status: 'active',
    scopes: normalizeDeveloperScopes(body.scopes),
    environment: body.environment || 'production',
    expiresAt: body.expiresAt || null,
    lastUsedAt: null,
    runtimeContract: DEVELOPER_WEBHOOKS_API_RUNTIME_CONTRACT.surfaceId
  };
  key.tokenPreview = tokenPreview(key.token);
  state.db.apiKeys.unshift(key);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'api-key-create', detail: `Created scoped API key ${key.label}` });
  return key;
}

export function revokeDeveloperScopedApiKey(state, actor, keyId) {
  ensureDeveloperRuntimeCollections(state);
  const key = state.db.apiKeys.find((entry) => entry.id === keyId && entry.workspaceId === actor.workspace.id);
  if (!key) return null;
  key.revokedAt = nowIso();
  key.status = 'revoked';
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'api-key-revoke', detail: `Revoked scoped API key ${key.label || key.id}` });
  return key;
}

export function createDeveloperWebhookSubscription(state, actor, body = {}) {
  ensureDeveloperRuntimeCollections(state);
  const hookId = createId('hook');
  const hook = {
    id: hookId,
    workspaceId: actor.workspace.id,
    targetUrl: body.targetUrl,
    events: normalizeDeveloperScopes(body.events || 'audit,contact.created,campaign.sent'),
    status: 'active',
    subscriptionStatus: 'subscribed',
    signingSecret: body.signingSecret || signingSecretFor(actor.workspace.id, hookId),
    deliveryVersion: '2026-05-12.developer-runtime',
    createdBy: actor.user.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    runtimeContract: DEVELOPER_WEBHOOKS_API_RUNTIME_CONTRACT.surfaceId
  };
  state.db.webhooks.unshift(hook);
  recordWebhookSubscriptionLifecycle(state, actor, hook, 'subscription_created', 'Developer webhook subscription created with signing secret and event filters');
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'webhook-create', detail: `Created signed webhook ${body.targetUrl}` });
  return hook;
}

export function setDeveloperWebhookSubscriptionStatus(state, actor, hookId, status) {
  ensureDeveloperRuntimeCollections(state);
  const hook = state.db.webhooks.find((entry) => entry.id === hookId && entry.workspaceId === actor.workspace.id);
  if (!hook) return null;
  hook.status = status === 'active' ? 'active' : 'paused';
  hook.subscriptionStatus = hook.status === 'active' ? 'subscribed' : 'paused';
  hook.updatedAt = nowIso();
  recordWebhookSubscriptionLifecycle(state, actor, hook, hook.status === 'active' ? 'subscription_resumed' : 'subscription_paused');
  persistState(state);
  return hook;
}

export function dispatchDeveloperWebhookDelivery(state, actor, hookId, body = {}) {
  ensureDeveloperRuntimeCollections(state);
  const hook = state.db.webhooks.find((entry) => entry.id === hookId && entry.workspaceId === actor.workspace.id);
  if (!hook) return null;
  const eventType = body.eventType || hook.events?.[0] || 'developer.runtime.test';
  const delivery = signedDeliveryFor(hook, eventType, { data: body.payload || { source: 'developer_runtime_console', sample: true } });
  state.db.webhookDeliveries.unshift(delivery);
  recordWebhookSubscriptionLifecycle(state, actor, hook, 'signed_delivery_dispatched', `Delivery ${delivery.id} signed and sent`);
  persistState(state);
  return delivery;
}

export function replayDeveloperWebhookDelivery(state, actor, deliveryId) {
  ensureDeveloperRuntimeCollections(state);
  const original = state.db.webhookDeliveries.find((entry) => entry.id === deliveryId && entry.workspaceId === actor.workspace.id);
  if (!original) return null;
  const hook = state.db.webhooks.find((entry) => entry.id === original.webhookId && entry.workspaceId === actor.workspace.id);
  if (!hook) return null;
  const replay = signedDeliveryFor(hook, original.eventType, original.payload?.data || original.payload || {}, { status: 'replayed', replayOfDeliveryId: original.id, attempt: Number(original.attempt || 1) + 1 });
  state.db.webhookDeliveries.unshift(replay);
  recordWebhookSubscriptionLifecycle(state, actor, hook, 'signed_delivery_replayed', `Delivery ${original.id} replayed as ${replay.id}`);
  persistState(state);
  return replay;
}

export function recordDeveloperApiRequestAudit(state, actor, req, apiKey = null, status = 'authorized') {
  ensureDeveloperRuntimeCollections(state);
  const requestPath = req?.url || '/api/unknown';
  const key = apiKey?.id ? apiKey : null;
  const audit = {
    id: createId('apireq'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    apiKeyId: key?.id || 'workspace_api_key',
    tokenPreview: tokenPreview(key?.token || actor.workspace.apiKey),
    scopes: normalizeDeveloperScopes(key?.scopes || 'workspace:*'),
    method: req?.method || 'GET',
    path: requestPath,
    status,
    ip: req?.socket?.remoteAddress || 'local',
    createdAt: nowIso()
  };
  state.db.developerApiRequestAudits.unshift(audit);
  state.db.developerApiRequestAudits = state.db.developerApiRequestAudits.slice(0, 1000);
  if (key) key.lastUsedAt = audit.createdAt;
  return audit;
}

export function buildDeveloperApiRuntimeSnapshot(state, workspaceId) {
  ensureDeveloperRuntimeCollections(state);
  const keys = state.db.apiKeys.filter((entry) => entry.workspaceId === workspaceId);
  const hooks = state.db.webhooks.filter((entry) => entry.workspaceId === workspaceId);
  const deliveries = state.db.webhookDeliveries.filter((entry) => entry.workspaceId === workspaceId);
  const requestAudits = state.db.developerApiRequestAudits.filter((entry) => entry.workspaceId === workspaceId);
  const lifecycleEvents = state.db.webhookSubscriptionEvents.filter((entry) => entry.workspaceId === workspaceId);
  const scopedKeys = keys.filter((entry) => Array.isArray(entry.scopes) && entry.scopes.length > 0);
  const signedDeliveries = deliveries.filter((entry) => entry.signed || entry.signature);
  return {
    ...DEVELOPER_WEBHOOKS_API_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    apiKeys: {
      total: keys.length,
      activeCount: keys.filter((entry) => !entry.revokedAt && entry.status !== 'revoked').length,
      revokedCount: keys.filter((entry) => entry.revokedAt || entry.status === 'revoked').length,
      scopedKeyCount: scopedKeys.length,
      scopes: Array.from(new Set(scopedKeys.flatMap((entry) => entry.scopes || []))).sort(),
      recent: keys.slice(0, 8).map((entry) => ({ id: entry.id, label: entry.label, status: entry.revokedAt ? 'revoked' : (entry.status || 'active'), tokenPreview: entry.tokenPreview || tokenPreview(entry.token), scopes: entry.scopes || ['workspace:*'], environment: entry.environment || 'production', expiresAt: entry.expiresAt || null, lastUsedAt: entry.lastUsedAt || null }))
    },
    requestAudit: {
      count: requestAudits.length,
      recent: requestAudits.slice(0, 10)
    },
    webhookSubscriptions: {
      total: hooks.length,
      activeCount: hooks.filter((entry) => entry.status === 'active').length,
      pausedCount: hooks.filter((entry) => entry.status === 'paused').length,
      signedCount: hooks.filter((entry) => entry.signingSecret).length,
      lifecycleEventCount: lifecycleEvents.length,
      recentLifecycleEvents: lifecycleEvents.slice(0, 10),
      recent: hooks.slice(0, 8).map((entry) => ({ id: entry.id, targetUrl: entry.targetUrl, status: entry.status, subscriptionStatus: entry.subscriptionStatus || entry.status, events: entry.events || [], signingReady: Boolean(entry.signingSecret), deliveryVersion: entry.deliveryVersion || 'legacy' }))
    },
    deliveries: {
      total: deliveries.length,
      signedCount: signedDeliveries.length,
      replayCount: deliveries.filter((entry) => entry.replayOfDeliveryId).length,
      recent: deliveries.slice(0, 10).map((entry) => ({ id: entry.id, webhookId: entry.webhookId, eventType: entry.eventType, status: entry.status, signed: Boolean(entry.signed || entry.signature), replayOfDeliveryId: entry.replayOfDeliveryId || null, signaturePreview: entry.signature ? `${entry.signature.slice(0, 10)}…` : null, createdAt: entry.createdAt }))
    },
    runtimeHealth: {
      scopedKeysReady: scopedKeys.length > 0,
      requestAuditReady: requestAudits.length > 0,
      subscriptionsReady: hooks.length > 0,
      signedDeliveryReady: signedDeliveries.length > 0,
      replayReady: deliveries.some((entry) => entry.replayOfDeliveryId)
    }
  };
}

export function persistDeveloperApiRuntimeSnapshot(state, workspaceId) {
  ensureDeveloperRuntimeCollections(state);
  const snapshot = buildDeveloperApiRuntimeSnapshot(state, workspaceId);
  state.db.developerRuntimeSnapshots.unshift({ id: createId('devsnap'), workspaceId, createdAt: snapshot.generatedAt, snapshot });
  persistState(state);
  return snapshot;
}

export const BILLING_ENTITLEMENTS_USAGE_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'billing_entitlements_usage_runtime_layer',
  label: 'Billing entitlement and usage runtime contract',
  controls: [
    'plan_entitlement_reconciliation',
    'usage_metering_ledger',
    'trial_lifecycle',
    'invoice_tax_collection_run',
    'billing_runtime_snapshot_api'
  ],
  evidenceContract: [
    'plan_changes_reconcile_feature_entitlements_and_monthly_limits',
    'usage_meter_events_record_metric_cycle_limit_and_overage',
    'trial_events_track_plan_status_start_and_expiry',
    'invoice_runs_include_base_usage_tax_and_collection_state',
    'runtime_snapshot_persists_entitlements_usage_trials_invoices_and_health'
  ]
});

function ensureBillingRuntimeCollections(state) {
  state.db.billingRuntimeSnapshots ||= [];
  state.db.billingUsageMeterEvents ||= [];
  state.db.billingEntitlementEvents ||= [];
  state.db.billingTrialEvents ||= [];
  state.db.billingInvoiceEvents ||= [];
}

function planById(planId) {
  return PLAN_CATALOG.find((plan) => plan.id === planId) || PLAN_CATALOG[0];
}

function planPriceCents(plan) {
  const numeric = Number(String(plan?.price || '$0').replace(/[^0-9.]/g, '')) || 0;
  return Math.round(numeric * 100);
}

function currentBillingCycle() {
  return nowIso().slice(0, 7);
}

function money(cents) {
  return `$${(Math.max(0, Number(cents || 0)) / 100).toFixed(2)}`;
}

function billingEntitlementsForPlan(plan) {
  return {
    planId: plan.id,
    monthlySendLimit: plan.monthlyLimit,
    features: { ...plan.features },
    seatsIncluded: plan.id === 'starter' ? 1 : plan.id === 'growth' ? 5 : 25,
    apiAccess: true,
    supportTier: plan.id === 'pro' ? 'priority' : plan.id === 'growth' ? 'standard' : 'community',
    entitlementVersion: `${BILLING_ENTITLEMENTS_USAGE_RUNTIME_CONTRACT.surfaceId}:${plan.id}:2026-05-12`
  };
}

function billingUsageTotals(state, workspaceId, cycle = currentBillingCycle()) {
  ensureBillingRuntimeCollections(state);
  const usage = state.db.billingUsageMeterEvents.filter((entry) => entry.workspaceId === workspaceId && entry.cycle === cycle);
  return usage.reduce((acc, entry) => {
    acc[entry.metric] = (acc[entry.metric] || 0) + Number(entry.quantity || 0);
    return acc;
  }, {});
}

function recordBillingEntitlementEvent(state, actor, action, detail = '', extra = {}) {
  ensureBillingRuntimeCollections(state);
  const plan = planById(actor.workspace.planId);
  const entitlements = billingEntitlementsForPlan(plan);
  actor.workspace.billing ||= { currentPlan: plan.id, invoices: [] };
  actor.workspace.billing.entitlements = entitlements;
  actor.workspace.billing.entitlementsUpdatedAt = nowIso();
  const event = {
    id: createId('billent'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    action,
    detail,
    planId: plan.id,
    entitlements,
    runtimeContract: BILLING_ENTITLEMENTS_USAGE_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso(),
    ...extra
  };
  state.db.billingEntitlementEvents.unshift(event);
  state.db.billingEntitlementEvents = state.db.billingEntitlementEvents.slice(0, 500);
  return event;
}

export function reconcileBillingEntitlements(state, actor, body = {}) {
  const event = recordBillingEntitlementEvent(state, actor, 'entitlements_reconciled', body.reason || 'Manual entitlement reconciliation from billing runtime center');
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'billing-entitlements-reconcile', detail: `Reconciled entitlements for ${event.planId}` });
  return event;
}

export function recordBillingUsageMeterEvent(state, actor, body = {}) {
  ensureBillingRuntimeCollections(state);
  const plan = planById(actor.workspace.planId);
  const cycle = body.cycle || currentBillingCycle();
  const metric = body.metric || 'emails_sent';
  const quantity = Math.max(0, Number(body.quantity || 0));
  const before = billingUsageTotals(state, actor.workspace.id, cycle)[metric] || 0;
  const after = before + quantity;
  const limit = metric === 'emails_sent' ? plan.monthlyLimit : Number(body.limit || plan.monthlyLimit);
  const event = {
    id: createId('billuse'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    metric,
    quantity,
    cycle,
    limit,
    cycleUsageBeforeEvent: before,
    cycleUsageAfterEvent: after,
    overageQuantity: Math.max(0, after - limit),
    source: body.source || 'billing_runtime_console',
    runtimeContract: BILLING_ENTITLEMENTS_USAGE_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.billingUsageMeterEvents.unshift(event);
  state.db.billingUsageMeterEvents = state.db.billingUsageMeterEvents.slice(0, 1000);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'billing-usage-meter', detail: `Recorded ${quantity} ${metric} for ${cycle}` });
  return event;
}

export function startBillingTrial(state, actor, body = {}) {
  ensureBillingRuntimeCollections(state);
  const plan = planById(body.planId || 'pro');
  const now = new Date();
  const endsAt = body.endsAt || new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  actor.workspace.billing ||= { currentPlan: actor.workspace.planId, invoices: [] };
  actor.workspace.billing.trial = { planId: plan.id, status: 'active', startedAt: nowIso(), endsAt, source: body.source || 'billing_runtime_console' };
  const event = {
    id: createId('billtrial'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    action: 'trial_started',
    planId: plan.id,
    status: 'active',
    startedAt: actor.workspace.billing.trial.startedAt,
    endsAt,
    runtimeContract: BILLING_ENTITLEMENTS_USAGE_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.billingTrialEvents.unshift(event);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'billing-trial-start', detail: `Started ${plan.id} trial until ${endsAt}` });
  return event;
}

export function runBillingInvoiceCollection(state, actor, body = {}) {
  ensureBillingRuntimeCollections(state);
  const plan = planById(actor.workspace.planId);
  const cycle = body.cycle || currentBillingCycle();
  const totals = billingUsageTotals(state, actor.workspace.id, cycle);
  const sendUsage = Number(totals.emails_sent || 0);
  const overageQuantity = Math.max(0, sendUsage - plan.monthlyLimit);
  const baseCents = planPriceCents(plan);
  const overageCents = overageQuantity * Number(body.overageCentsPerEmail || 1);
  const taxableCents = baseCents + overageCents;
  const taxRate = Number(body.taxRate || 0.0825);
  const taxCents = Math.round(taxableCents * taxRate);
  const amountCents = taxableCents + taxCents;
  const invoice = {
    id: createId('inv'),
    workspaceId: actor.workspace.id,
    planId: plan.id,
    cycle,
    amount: money(amountCents),
    amountCents,
    baseCents,
    overageCents,
    taxCents,
    taxRate,
    status: body.status || 'open',
    collectionState: body.collectionState || 'ready_to_collect',
    lineItems: [
      { label: `${plan.name} plan`, amountCents: baseCents },
      { label: `${overageQuantity} email overage`, amountCents: overageCents },
      { label: 'Estimated tax', amountCents: taxCents }
    ],
    createdAt: nowIso()
  };
  actor.workspace.billing ||= { currentPlan: plan.id, invoices: [] };
  actor.workspace.billing.invoices.unshift(invoice);
  const event = {
    id: createId('billinv'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    invoiceId: invoice.id,
    action: 'invoice_collection_run_created',
    planId: plan.id,
    cycle,
    amountCents,
    baseCents,
    overageCents,
    taxCents,
    status: invoice.status,
    collectionState: invoice.collectionState,
    runtimeContract: BILLING_ENTITLEMENTS_USAGE_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.billingInvoiceEvents.unshift(event);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'billing-invoice-run', detail: `Created billing invoice ${invoice.id} for ${cycle}` });
  return { invoice, event };
}

export function buildBillingEntitlementsRuntimeSnapshot(state, workspaceId) {
  ensureBillingRuntimeCollections(state);
  const workspace = state.db.workspaces.find((entry) => entry.id === workspaceId) || { id: workspaceId, planId: 'starter', billing: { invoices: [] } };
  const plan = planById(workspace.planId);
  const cycle = currentBillingCycle();
  const usageTotals = billingUsageTotals(state, workspaceId, cycle);
  const entitlementEvents = state.db.billingEntitlementEvents.filter((entry) => entry.workspaceId === workspaceId);
  const usageEvents = state.db.billingUsageMeterEvents.filter((entry) => entry.workspaceId === workspaceId);
  const trialEvents = state.db.billingTrialEvents.filter((entry) => entry.workspaceId === workspaceId);
  const invoiceEvents = state.db.billingInvoiceEvents.filter((entry) => entry.workspaceId === workspaceId);
  const snapshots = state.db.billingRuntimeSnapshots.filter((entry) => entry.workspaceId === workspaceId);
  const invoices = workspace.billing?.invoices || [];
  const entitlements = workspace.billing?.entitlements || billingEntitlementsForPlan(plan);
  const sendUsage = Number(usageTotals.emails_sent || 0);
  return {
    ...BILLING_ENTITLEMENTS_USAGE_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    plan: {
      id: plan.id,
      name: plan.name,
      price: plan.price,
      monthlyLimit: plan.monthlyLimit,
      priceCents: planPriceCents(plan),
      activeTrial: workspace.billing?.trial || null
    },
    entitlements: {
      current: entitlements,
      eventCount: entitlementEvents.length,
      recentEvents: entitlementEvents.slice(0, 10)
    },
    usage: {
      cycle,
      totals: usageTotals,
      monthlySendUsage: sendUsage,
      monthlySendLimit: plan.monthlyLimit,
      overageQuantity: Math.max(0, sendUsage - plan.monthlyLimit),
      eventCount: usageEvents.length,
      recentEvents: usageEvents.slice(0, 10)
    },
    trials: {
      active: workspace.billing?.trial?.status === 'active' ? workspace.billing.trial : null,
      eventCount: trialEvents.length,
      recentEvents: trialEvents.slice(0, 10)
    },
    invoices: {
      total: invoices.length,
      openCount: invoices.filter((entry) => ['open', 'pending'].includes(entry.status)).length,
      runtimeInvoiceEventCount: invoiceEvents.length,
      recent: invoices.slice(0, 8),
      recentRuntimeEvents: invoiceEvents.slice(0, 10)
    },
    snapshots: { count: snapshots.length, latestCreatedAt: snapshots[0]?.createdAt || null },
    runtimeHealth: {
      entitlementsReady: entitlementEvents.length > 0 || Boolean(workspace.billing?.entitlements),
      usageMeterReady: usageEvents.length > 0,
      trialLifecycleReady: trialEvents.length > 0 || Boolean(workspace.billing?.trial),
      invoiceRunReady: invoiceEvents.length > 0,
      snapshotReady: snapshots.length > 0
    }
  };
}

export function persistBillingEntitlementsRuntimeSnapshot(state, actor, reason = 'manual_billing_runtime_snapshot') {
  ensureBillingRuntimeCollections(state);
  const snapshot = buildBillingEntitlementsRuntimeSnapshot(state, actor.workspace.id);
  state.db.billingRuntimeSnapshots.unshift({ id: createId('billsnap'), workspaceId: actor.workspace.id, userId: actor.user.id, reason, createdAt: snapshot.generatedAt, snapshot });
  state.db.billingRuntimeSnapshots = state.db.billingRuntimeSnapshots.slice(0, 100);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'billing-runtime-snapshot', detail: `Captured billing runtime snapshot (${reason})` });
  return snapshot;
}

export const TEAM_GOVERNANCE_PERMISSIONS_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'team_governance_permissions_runtime_layer',
  label: 'Team governance and permissions runtime contract',
  controls: [
    'permission_policy_matrix',
    'delegated_admin_scope_ledger',
    'scim_provisioning_lifecycle',
    'access_review_attestation',
    'region_governance_policy',
    'team_runtime_snapshot_api'
  ],
  evidenceContract: [
    'role_policies_record_permissions_scope_and_actor',
    'delegated_admin_events_track_granted_scope_and_expiry',
    'scim_provisioning_records_external_identity_action_and_status',
    'access_reviews_record_owner_due_date_and_attestation_status',
    'region_governance_records_data_region_policy_and_effective_state',
    'runtime_snapshot_persists_team_policies_reviews_scim_delegation_and_health'
  ]
});

function ensureTeamGovernanceRuntimeCollections(state) {
  state.db.teamGovernanceRuntimeSnapshots ||= [];
  state.db.teamPermissionPolicyEvents ||= [];
  state.db.teamAccessReviewEvents ||= [];
  state.db.teamDelegatedAdminEvents ||= [];
  state.db.teamScimProvisioningEvents ||= [];
  state.db.teamRegionGovernanceEvents ||= [];
}

function normalizePermissionList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const permissions = raw.map((entry) => String(entry || '').trim()).filter(Boolean);
  return Array.from(new Set(permissions.length ? permissions : ['campaigns:read', 'reports:read']));
}

function normalizeTeamRole(role) {
  return ['owner', 'admin', 'member', 'viewer', 'developer'].includes(role) ? role : 'member';
}

export function recordTeamPermissionPolicy(state, actor, body = {}) {
  ensureTeamGovernanceRuntimeCollections(state);
  actor.workspace.settings.teamPermissionPolicies ||= {};
  const role = normalizeTeamRole(body.role || 'member');
  const policy = {
    role,
    permissions: normalizePermissionList(body.permissions || 'campaigns:read,reports:read'),
    scope: body.scope || 'workspace',
    enforcement: body.enforcement || 'enforced',
    updatedBy: actor.user.id,
    updatedAt: nowIso(),
    runtimeContract: TEAM_GOVERNANCE_PERMISSIONS_RUNTIME_CONTRACT.surfaceId
  };
  actor.workspace.settings.teamPermissionPolicies[role] = policy;
  const event = { id: createId('teampol'), workspaceId: actor.workspace.id, userId: actor.user.id, action: 'permission_policy_updated', ...policy, createdAt: nowIso() };
  state.db.teamPermissionPolicyEvents.unshift(event);
  state.db.teamPermissionPolicyEvents = state.db.teamPermissionPolicyEvents.slice(0, 500);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'team-permission-policy-update', detail: `Updated ${role} permission policy` });
  return event;
}

export function recordTeamAccessReview(state, actor, body = {}) {
  ensureTeamGovernanceRuntimeCollections(state);
  const event = {
    id: createId('teamrev'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    reviewName: body.reviewName || 'Quarterly access review',
    status: body.status || 'open',
    ownerRole: actor.membership.role,
    dueAt: body.dueAt || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    attestation: body.attestation || 'memberships_pending_review',
    activeMemberCount: state.db.memberships.filter((entry) => entry.workspaceId === actor.workspace.id && entry.status === 'active').length,
    runtimeContract: TEAM_GOVERNANCE_PERMISSIONS_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.teamAccessReviewEvents.unshift(event);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'team-access-review-create', detail: `Created ${event.reviewName}` });
  return event;
}

export function recordTeamDelegatedAdminGrant(state, actor, body = {}) {
  ensureTeamGovernanceRuntimeCollections(state);
  const event = {
    id: createId('teamdel'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    targetUserId: body.targetUserId || actor.user.id,
    delegatedRole: normalizeTeamRole(body.delegatedRole || 'admin'),
    scope: body.scope || 'audience_management',
    expiresAt: body.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    status: body.status || 'granted',
    runtimeContract: TEAM_GOVERNANCE_PERMISSIONS_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.teamDelegatedAdminEvents.unshift(event);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'team-delegated-admin-grant', detail: `Granted ${event.delegatedRole} scope ${event.scope}` });
  return event;
}

export function recordTeamScimProvisioningEvent(state, actor, body = {}) {
  ensureTeamGovernanceRuntimeCollections(state);
  const event = {
    id: createId('teamscim'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    externalId: body.externalId || createId('scim_ext'),
    email: body.email || `scim-${Date.now()}@example.test`,
    action: body.action || 'provision_user',
    status: body.status || 'applied',
    role: normalizeTeamRole(body.role || 'member'),
    identityProvider: body.identityProvider || 'Okta SCIM directory',
    runtimeContract: TEAM_GOVERNANCE_PERMISSIONS_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.teamScimProvisioningEvents.unshift(event);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'team-scim-provisioning', detail: `${event.action} ${event.email}` });
  return event;
}

export function recordTeamRegionGovernanceEvent(state, actor, body = {}) {
  ensureTeamGovernanceRuntimeCollections(state);
  actor.workspace.settings.teamRegionGovernance ||= {};
  const policy = {
    region: body.region || 'us',
    dataResidency: body.dataResidency || 'enabled',
    policy: body.policy || 'workspace_data_region_enforced',
    effectiveState: body.effectiveState || 'active',
    updatedAt: nowIso()
  };
  actor.workspace.settings.teamRegionGovernance = policy;
  const event = { id: createId('teamreg'), workspaceId: actor.workspace.id, userId: actor.user.id, ...policy, runtimeContract: TEAM_GOVERNANCE_PERMISSIONS_RUNTIME_CONTRACT.surfaceId, createdAt: nowIso() };
  state.db.teamRegionGovernanceEvents.unshift(event);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'team-region-governance-update', detail: `Set team region governance to ${policy.region}/${policy.effectiveState}` });
  return event;
}

export function buildTeamGovernanceRuntimeSnapshot(state, workspaceId) {
  ensureTeamGovernanceRuntimeCollections(state);
  const workspace = state.db.workspaces.find((entry) => entry.id === workspaceId) || { id: workspaceId, settings: {} };
  const memberships = state.db.memberships.filter((entry) => entry.workspaceId === workspaceId && entry.status === 'active');
  const invitations = state.db.invitations.filter((entry) => entry.workspaceId === workspaceId);
  const permissionEvents = state.db.teamPermissionPolicyEvents.filter((entry) => entry.workspaceId === workspaceId);
  const accessReviews = state.db.teamAccessReviewEvents.filter((entry) => entry.workspaceId === workspaceId);
  const delegatedAdminEvents = state.db.teamDelegatedAdminEvents.filter((entry) => entry.workspaceId === workspaceId);
  const scimEvents = state.db.teamScimProvisioningEvents.filter((entry) => entry.workspaceId === workspaceId);
  const regionEvents = state.db.teamRegionGovernanceEvents.filter((entry) => entry.workspaceId === workspaceId);
  const snapshots = state.db.teamGovernanceRuntimeSnapshots.filter((entry) => entry.workspaceId === workspaceId);
  const roleCounts = memberships.reduce((acc, entry) => { acc[entry.role] = (acc[entry.role] || 0) + 1; return acc; }, {});
  return {
    ...TEAM_GOVERNANCE_PERMISSIONS_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    memberships: {
      activeCount: memberships.length,
      roleCounts,
      pendingInviteCount: invitations.filter((entry) => entry.status === 'pending').length,
      recentMembers: memberships.slice(0, 10).map((entry) => ({ id: entry.id, userId: entry.userId, role: entry.role, status: entry.status }))
    },
    permissionPolicies: {
      current: workspace.settings?.teamPermissionPolicies || {},
      eventCount: permissionEvents.length,
      recentEvents: permissionEvents.slice(0, 10)
    },
    accessReviews: { count: accessReviews.length, openCount: accessReviews.filter((entry) => entry.status === 'open').length, recent: accessReviews.slice(0, 10) },
    delegatedAdmin: { count: delegatedAdminEvents.length, activeCount: delegatedAdminEvents.filter((entry) => entry.status === 'granted').length, recent: delegatedAdminEvents.slice(0, 10) },
    scimProvisioning: { count: scimEvents.length, appliedCount: scimEvents.filter((entry) => entry.status === 'applied').length, recent: scimEvents.slice(0, 10) },
    regionGovernance: { current: workspace.settings?.teamRegionGovernance || null, eventCount: regionEvents.length, recentEvents: regionEvents.slice(0, 10) },
    snapshots: { count: snapshots.length, latestCreatedAt: snapshots[0]?.createdAt || null },
    runtimeHealth: {
      permissionPolicyReady: permissionEvents.length > 0 || Boolean(Object.keys(workspace.settings?.teamPermissionPolicies || {}).length),
      accessReviewReady: accessReviews.length > 0,
      delegatedAdminReady: delegatedAdminEvents.length > 0,
      scimProvisioningReady: scimEvents.length > 0,
      regionGovernanceReady: regionEvents.length > 0,
      snapshotReady: snapshots.length > 0
    }
  };
}

export function persistTeamGovernanceRuntimeSnapshot(state, actor, reason = 'manual_team_governance_snapshot') {
  ensureTeamGovernanceRuntimeCollections(state);
  const snapshot = buildTeamGovernanceRuntimeSnapshot(state, actor.workspace.id);
  state.db.teamGovernanceRuntimeSnapshots.unshift({ id: createId('teamsnap'), workspaceId: actor.workspace.id, userId: actor.user.id, reason, createdAt: snapshot.generatedAt, snapshot });
  state.db.teamGovernanceRuntimeSnapshots = state.db.teamGovernanceRuntimeSnapshots.slice(0, 100);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'team-governance-runtime-snapshot', detail: `Captured team governance runtime snapshot (${reason})` });
  return snapshot;
}

export const DASHBOARD_HOME_INSIGHTS_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'dashboard_home_insights_runtime_layer',
  label: 'Dashboard home insights and task runtime contract',
  controls: [
    'role_aware_widget_composition',
    'saved_dashboard_view_preferences',
    'insight_priority_task_queue',
    'data_freshness_ledger',
    'dashboard_drillthrough_telemetry',
    'dashboard_runtime_snapshot_api'
  ],
  evidenceContract: [
    'dashboard_widgets_record_role_layout_visibility_and_preference_state',
    'saved_views_track_owner_analyst_operator_and_developer_entrypoints',
    'insight_tasks_record_priority_surface_reason_and_completion_state',
    'data_freshness_records_latest_event_job_campaign_and_contact_evidence',
    'drillthrough_events_record_widget_target_actor_and_route',
    'runtime_snapshot_persists_widgets_tasks_views_drillthrough_and_health'
  ]
});

function ensureDashboardRuntimeCollections(state) {
  state.db.dashboardRuntimeSnapshots ||= [];
  state.db.dashboardWidgetPreferenceEvents ||= [];
  state.db.dashboardInsightEvents ||= [];
  state.db.dashboardTaskQueueEvents ||= [];
  state.db.dashboardDrillthroughEvents ||= [];
  state.db.dashboardSavedViewEvents ||= [];
}

function dashboardRoleViews(role) {
  return [
    { id: 'owner_launch_readiness', label: 'Owner launch readiness', href: '/onboarding', roles: ['owner', 'admin'] },
    { id: 'campaign_operator_queue', label: 'Campaign operator queue', href: '/campaigns', roles: ['owner', 'admin', 'member'] },
    { id: 'analyst_performance_view', label: 'Analyst performance view', href: '/reports', roles: ['owner', 'admin', 'member'] },
    { id: 'developer_integration_health', label: 'Developer integration health', href: '/developer/webhooks', roles: ['owner', 'admin'] },
    { id: 'deliverability_compliance_watch', label: 'Deliverability compliance watch', href: '/deliverability', roles: ['owner', 'admin'] }
  ].filter((view) => view.roles.includes(role));
}

function dashboardReadinessFor(actor) {
  const workspace = actor?.workspace || { settings: {}, featureFlags: {}, billing: {} };
  const domains = workspace.settings?.domains || [];
  const steps = [
    { id: 'workspace', label: 'Create workspace', done: Boolean(workspace.id) },
    { id: 'sender_profile', label: 'Set sender profile', done: Boolean(workspace.settings?.senderEmail && workspace.settings?.senderName) },
    { id: 'domain_auth', label: 'Connect authenticated domain', done: domains.some((entry) => entry.authenticationStatus === 'authenticated') },
    { id: 'team', label: 'Invite teammates', done: Boolean(workspace.featureFlags?.multiUser) },
    { id: 'plan', label: 'Choose a send-ready plan', done: Boolean(workspace.planId && workspace.planId !== 'starter') }
  ];
  const missing = steps.filter((step) => !step.done);
  return { completed: steps.length - missing.length, total: steps.length, ready: missing.length === 0, missing };
}

export function recordDashboardWidgetPreference(state, actor, body = {}) {
  ensureDashboardRuntimeCollections(state);
  actor.workspace.settings.dashboardWidgetPreferences ||= {};
  const widgetId = body.widgetId || 'launch_readiness';
  const preference = {
    widgetId,
    role: actor.membership.role,
    visibility: body.visibility || 'visible',
    layout: body.layout || 'top_grid',
    pinned: body.pinned == null ? true : body.pinned === true || body.pinned === 'true',
    updatedBy: actor.user.id,
    updatedAt: nowIso(),
    runtimeContract: DASHBOARD_HOME_INSIGHTS_RUNTIME_CONTRACT.surfaceId
  };
  actor.workspace.settings.dashboardWidgetPreferences[widgetId] = preference;
  const event = { id: createId('dashpref'), workspaceId: actor.workspace.id, userId: actor.user.id, action: 'widget_preference_updated', ...preference, createdAt: nowIso() };
  state.db.dashboardWidgetPreferenceEvents.unshift(event);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'dashboard-widget-preference', detail: `Updated widget ${widgetId}` });
  return event;
}

export function recordDashboardSavedView(state, actor, body = {}) {
  ensureDashboardRuntimeCollections(state);
  const viewId = body.viewId || dashboardRoleViews(actor.membership.role)[0]?.id || 'dashboard_overview';
  const view = {
    id: createId('dashview'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    viewId,
    label: body.label || viewId.replace(/_/g, ' '),
    role: actor.membership.role,
    href: body.href || '/app',
    filters: body.filters || 'default',
    runtimeContract: DASHBOARD_HOME_INSIGHTS_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.dashboardSavedViewEvents.unshift(view);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'dashboard-saved-view', detail: `Saved dashboard view ${view.viewId}` });
  return view;
}

export function recordDashboardInsightAction(state, actor, body = {}) {
  ensureDashboardRuntimeCollections(state);
  const readiness = dashboardReadinessFor(actor);
  const insight = {
    id: createId('dashinsight'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    surface: body.surface || (readiness.ready ? 'campaign_launch' : 'onboarding'),
    priority: body.priority || (readiness.ready ? 'medium' : 'high'),
    reason: body.reason || (readiness.ready ? 'Workspace is launch-ready' : `Resolve ${readiness.missing[0]?.label || 'setup'} first`),
    status: body.status || 'open',
    targetRoute: body.targetRoute || (readiness.ready ? '/campaigns' : '/onboarding'),
    runtimeContract: DASHBOARD_HOME_INSIGHTS_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.dashboardInsightEvents.unshift(insight);
  state.db.dashboardTaskQueueEvents.unshift({ id: createId('dashtask'), workspaceId: actor.workspace.id, userId: actor.user.id, insightId: insight.id, status: insight.status, priority: insight.priority, targetRoute: insight.targetRoute, createdAt: insight.createdAt, runtimeContract: DASHBOARD_HOME_INSIGHTS_RUNTIME_CONTRACT.surfaceId });
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'dashboard-insight-action', detail: `Recorded ${insight.priority} dashboard insight for ${insight.surface}` });
  return insight;
}

export function recordDashboardDrillthroughEvent(state, actor, body = {}) {
  ensureDashboardRuntimeCollections(state);
  const event = {
    id: createId('dashdrill'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    widgetId: body.widgetId || 'launch_readiness',
    targetRoute: body.targetRoute || '/onboarding',
    actorRole: actor.membership.role,
    source: body.source || 'dashboard_home',
    runtimeContract: DASHBOARD_HOME_INSIGHTS_RUNTIME_CONTRACT.surfaceId,
    createdAt: nowIso()
  };
  state.db.dashboardDrillthroughEvents.unshift(event);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'dashboard-drillthrough', detail: `Dashboard drillthrough ${event.widgetId} -> ${event.targetRoute}` });
  return event;
}

export function buildDashboardHomeRuntimeSnapshot(state, actorOrWorkspaceId) {
  ensureDashboardRuntimeCollections(state);
  const workspaceId = typeof actorOrWorkspaceId === 'string' ? actorOrWorkspaceId : actorOrWorkspaceId.workspace.id;
  const workspace = state.db.workspaces.find((entry) => entry.id === workspaceId) || { id: workspaceId, settings: {}, featureFlags: {} };
  const membership = typeof actorOrWorkspaceId === 'string'
    ? state.db.memberships.find((entry) => entry.workspaceId === workspaceId && entry.status === 'active') || { role: 'owner' }
    : actorOrWorkspaceId.membership;
  const actor = typeof actorOrWorkspaceId === 'string' ? { workspace, membership, user: { id: null } } : actorOrWorkspaceId;
  const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId);
  const contacts = state.db.contacts.filter((entry) => entry.workspaceId === workspaceId);
  const jobs = state.db.jobs.filter((entry) => entry.workspaceId === workspaceId);
  const recentEvents = state.db.events.filter((entry) => entry.workspaceId === workspaceId).slice(0, 10);
  const preferences = state.db.dashboardWidgetPreferenceEvents.filter((entry) => entry.workspaceId === workspaceId);
  const insights = state.db.dashboardInsightEvents.filter((entry) => entry.workspaceId === workspaceId);
  const tasks = state.db.dashboardTaskQueueEvents.filter((entry) => entry.workspaceId === workspaceId);
  const drillthrough = state.db.dashboardDrillthroughEvents.filter((entry) => entry.workspaceId === workspaceId);
  const savedViews = state.db.dashboardSavedViewEvents.filter((entry) => entry.workspaceId === workspaceId);
  const snapshots = state.db.dashboardRuntimeSnapshots.filter((entry) => entry.workspaceId === workspaceId);
  const readiness = dashboardReadinessFor(actor);
  const dataFreshness = {
    latestEventAt: recentEvents[0]?.createdAt || null,
    latestJobAt: jobs[0]?.updatedAt || jobs[0]?.createdAt || null,
    latestCampaignAt: campaigns[0]?.updatedAt || campaigns[0]?.createdAt || null,
    latestContactAt: contacts[0]?.updatedAt || contacts[0]?.createdAt || null,
    recentEventCount: recentEvents.length
  };
  return {
    ...DASHBOARD_HOME_INSIGHTS_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    role: membership.role,
    widgets: {
      currentPreferences: workspace.settings?.dashboardWidgetPreferences || {},
      preferenceEventCount: preferences.length,
      recentPreferences: preferences.slice(0, 10)
    },
    savedViews: {
      roleViews: dashboardRoleViews(membership.role),
      savedViewEventCount: savedViews.length,
      recent: savedViews.slice(0, 10)
    },
    insightQueue: {
      readiness,
      insightCount: insights.length,
      taskCount: tasks.length,
      openTaskCount: tasks.filter((entry) => entry.status !== 'completed').length,
      recentInsights: insights.slice(0, 10),
      recentTasks: tasks.slice(0, 10)
    },
    dataFreshness,
    drillthrough: { count: drillthrough.length, recent: drillthrough.slice(0, 10) },
    snapshots: { count: snapshots.length, latestCreatedAt: snapshots[0]?.createdAt || null },
    runtimeHealth: {
      widgetPreferencesReady: preferences.length > 0 || Boolean(Object.keys(workspace.settings?.dashboardWidgetPreferences || {}).length),
      savedViewsReady: savedViews.length > 0,
      insightsReady: insights.length > 0,
      taskQueueReady: tasks.length > 0,
      drillthroughReady: drillthrough.length > 0,
      dataFreshnessReady: Boolean(dataFreshness.latestEventAt || dataFreshness.latestJobAt || dataFreshness.latestCampaignAt || dataFreshness.latestContactAt),
      snapshotReady: snapshots.length > 0
    }
  };
}

export function persistDashboardHomeRuntimeSnapshot(state, actor, reason = 'manual_dashboard_runtime_snapshot') {
  ensureDashboardRuntimeCollections(state);
  const snapshot = buildDashboardHomeRuntimeSnapshot(state, actor);
  state.db.dashboardRuntimeSnapshots.unshift({ id: createId('dashsnap'), workspaceId: actor.workspace.id, userId: actor.user.id, reason, createdAt: snapshot.generatedAt, snapshot });
  state.db.dashboardRuntimeSnapshots = state.db.dashboardRuntimeSnapshots.slice(0, 100);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'dashboard-runtime-snapshot', detail: `Captured dashboard runtime snapshot (${reason})` });
  return snapshot;
}

export function findUserByEmail(state, email) {
  return state.db.users.find((user) => user.email.toLowerCase() === String(email || '').toLowerCase());
}

export function membershipsForUser(state, userId) {
  return state.db.memberships.filter((membership) => membership.userId === userId && membership.status === 'active');
}

export function actorFromUser(state, user) {
  if (!user) return null;
  const memberships = membershipsForUser(state, user.id);
  const membership = memberships.find((entry) => entry.workspaceId === user.activeWorkspaceId) || memberships[0];
  if (!membership) return null;
  const workspace = state.db.workspaces.find((entry) => entry.id === membership.workspaceId);
  if (!workspace) return null;
  return { user, workspace, membership, memberships };
}

export function getCurrentActor(state, req) {
  const session = getSessionFromRequest(state, req);
  if (!session) return null;
  return actorFromUser(state, state.db.users.find((entry) => entry.id === session.userId));
}

export function apiActor(state, req) {
  const viaSession = getCurrentActor(state, req);
  if (viaSession) return viaSession;
  const auth = req.headers.authorization || req.headers['x-api-key'];
  if (!auth) return null;
  const token = String(auth).startsWith('Bearer ') ? String(auth).slice(7) : String(auth);
  const directWorkspace = state.db.workspaces.find((entry) => entry.apiKey === token) || null;
  const scopedKey = state.db.apiKeys.find((key) => key.token === token && !key.revokedAt && key.status !== 'revoked') || null;
  const workspace = directWorkspace || state.db.workspaces.find((entry) => scopedKey && scopedKey.workspaceId === entry.id) || null;
  if (!workspace) return null;
  const membership = state.db.memberships.find((entry) => entry.workspaceId === workspace.id && entry.status === 'active');
  const user = membership ? state.db.users.find((entry) => entry.id === membership.userId) : null;
  if (!user || !membership) return null;
  const actor = { user, workspace, membership, memberships: membershipsForUser(state, user.id) };
  if (!req.__mailcloneDeveloperApiAuditRecorded) {
    recordDeveloperApiRequestAudit(state, actor, req, scopedKey || { id: 'workspace_api_key', token: workspace.apiKey, scopes: ['workspace:*'] });
    req.__mailcloneDeveloperApiAuditRecorded = true;
    persistState(state);
  }
  return actor;
}

export function recordEvent(state, { workspaceId, type, message, level = 'info', meta = {} }) {
  state.db.events.unshift({ id: createId('event'), workspaceId, type, message, level, meta, createdAt: nowIso() });
  const hooks = state.db.webhooks.filter((hook) => hook.workspaceId === workspaceId && hook.status === 'active');
  for (const hook of hooks) {
    state.db.webhookDeliveries.unshift(signedDeliveryFor(hook, type, { type, message, meta }));
  }
}

export function createNotification(state, { workspaceId, type, payload }) {
  const note = { id: createId('note'), workspaceId, type, payload, createdAt: nowIso(), status: 'sent' };
  state.db.notifications.unshift(note);
  recordEvent(state, { workspaceId, type: `notification:${type}`, message: `${type} notification created`, meta: payload });
  return note;
}

export function recordAudit(state, { workspaceId, userId, action, detail }) {
  state.db.auditEvents.unshift({ id: createId('audit'), workspaceId, userId, action, detail, createdAt: nowIso() });
  recordEvent(state, { workspaceId, type: 'audit', message: `${action}: ${detail}`, meta: { userId } });
  persistState(state);
}

export function enqueueJob(state, { type, workspaceId, userId, payload, runAt }) {
  const job = { id: createId('job'), type, workspaceId, userId, payload, status: 'pending', createdAt: nowIso(), updatedAt: nowIso(), runAt: runAt || nowIso(), result: null };
  state.db.jobs.unshift(job);
  recordEvent(state, { workspaceId, type: 'job-queued', message: `${type} queued`, meta: { jobId: job.id } });
  persistState(state);
  return job;
}

export function createAccount(state, { name, email, password, workspaceName }, req) {
  const workspace = createWorkspace(workspaceName, name);
  const user = { id: createId('user'), name, email, passwordHash: hashPassword(password), activeWorkspaceId: workspace.id, createdAt: nowIso() };
  state.db.workspaces.push(workspace);
  state.db.users.push(user);
  state.db.memberships.push({ id: createId('mship'), userId: user.id, workspaceId: workspace.id, role: 'owner', status: 'active', createdAt: nowIso() });
  state.db.audiences.push(createAudience(workspace.id, 'Main audience'));
  state.db.apiKeys.unshift({ id: createId('apikey'), workspaceId: workspace.id, label: 'Default workspace key', token: workspace.apiKey, createdBy: user.id, createdAt: nowIso(), revokedAt: null });
  const session = createSession(state, user, req, { reason: 'signup' });
  createNotification(state, { workspaceId: workspace.id, type: 'account-created', payload: { email: user.email, workspaceName: workspace.name } });
  recordAudit(state, { workspaceId: workspace.id, userId: user.id, action: 'signup', detail: `Created workspace ${workspace.name}` });
  return { user, workspace, session };
}

export function createWorkspaceForUser(state, actor, name) {
  const workspace = createWorkspace(name, actor.user.name);
  state.db.workspaces.push(workspace);
  state.db.memberships.push({ id: createId('mship'), userId: actor.user.id, workspaceId: workspace.id, role: 'owner', status: 'active', createdAt: nowIso() });
  state.db.audiences.push(createAudience(workspace.id, 'Main audience'));
  state.db.apiKeys.unshift({ id: createId('apikey'), workspaceId: workspace.id, label: 'Default workspace key', token: workspace.apiKey, createdBy: actor.user.id, createdAt: nowIso(), revokedAt: null });
  actor.user.activeWorkspaceId = workspace.id;
  persistState(state);
  recordAudit(state, { workspaceId: workspace.id, userId: actor.user.id, action: 'workspace-create', detail: `Created workspace ${workspace.name}` });
}

export function applyBillingPlan(state, actor, planId) {
  ensureBillingRuntimeCollections(state);
  const plan = planById(planId);
  actor.workspace.planId = plan.id;
  actor.workspace.billing ||= { currentPlan: plan.id, invoices: [] };
  actor.workspace.billing.currentPlan = plan.id;
  const invoice = { id: createId('inv'), amount: plan.id === 'starter' ? '$0' : plan.id === 'growth' ? '$49' : '$149', status: 'pending', planId: plan.id, createdAt: nowIso() };
  actor.workspace.billing.invoices.unshift(invoice);
  recordBillingEntitlementEvent(state, actor, 'plan_changed', `Plan changed to ${plan.id}`, { invoiceId: invoice.id });
  state.db.billingInvoiceEvents.unshift({ id: createId('billinv'), workspaceId: actor.workspace.id, userId: actor.user.id, invoiceId: invoice.id, action: 'plan_change_invoice_created', planId: plan.id, status: invoice.status, amount: invoice.amount, runtimeContract: BILLING_ENTITLEMENTS_USAGE_RUNTIME_CONTRACT.surfaceId, createdAt: nowIso() });
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'billing-plan-change', detail: `Plan changed to ${plan.id}` });
}

export function updateSettings(state, actor, body) {
  actor.workspace.settings = { senderName: body.senderName, senderEmail: body.senderEmail, replyTo: body.replyTo, timezone: body.timezone, address: body.address, brandColor: body.brandColor, domains: actor.workspace.settings.domains || [] };
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'settings-update', detail: 'Updated workspace settings' });
}

export function addDomain(state, actor, domainInput) {
  const name = normalizeDomainName(domainInput);
  actor.workspace.settings.domains ||= [];
  if (!actor.workspace.settings.domains.some((entry) => entry.name === name)) {
    actor.workspace.settings.domains.unshift({ id: createId('domain'), name, verificationStatus: 'pending', authenticationStatus: 'pending', isDefault: actor.workspace.settings.domains.length === 0, createdAt: nowIso() });
    persistState(state);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'domain-add', detail: `Added sending domain ${name}` });
  }
}

export function storeAsset(state, actor, body) {
  const assetId = createId('asset');
  const storagePath = writeUpload(assetId, body.body || '');
  state.db.assets.unshift({ id: assetId, workspaceId: actor.workspace.id, name: body.name, folder: body.folder || 'Root', contentType: body.contentType || 'text/plain', altText: body.altText || '', storagePath, usageCount: 0, createdBy: actor.user.id, createdAt: nowIso() });
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'asset-upload', detail: `Stored asset ${body.name}` });
}

export function createExport(state, actor, label, body) {
  const exportId = createId('export');
  const storagePath = writeExport(exportId, body);
  const entry = { id: exportId, workspaceId: actor.workspace.id, label, createdBy: actor.user.id, createdAt: nowIso(), storagePath };
  state.db.exports.unshift(entry);
  persistState(state);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'state-export', detail: `Generated export ${label}` });
  return entry;
}

export function formIds(body, key) {
  return formArray(body, key);
}

export function contactPayload(body) {
  return { firstName: body.firstName || '', lastName: body.lastName || '', email: body.email || '', status: body.status || 'subscribed', tags: csvSplit(body.tags), interests: csvSplit(body.interests), groups: body.groupCategory && body.groupValue ? { [body.groupCategory]: body.groupValue } : {}, notes: body.notes || '', phone: body.phone || '' };
}
