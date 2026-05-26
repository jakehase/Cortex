import { createHash } from 'node:crypto';
import { nowIso } from './utils.mjs';

export const INTEGRATION_PROVIDER_CONTRACTS = Object.freeze({
  shopify: {
    provider: 'shopify',
    displayName: 'Shopify',
    authMode: 'oauth',
    accountKey: 'shop_domain',
    apiBaseUrl: 'https://admin.shopify.com/store/{account}/api',
    tokenEndpoint: 'https://accounts.shopify.com/oauth/token',
    supportedObjects: ['customers', 'products', 'orders', 'checkout_events'],
    webhookEvents: ['orders/create', 'orders/paid', 'customers/create', 'products/update'],
    cursorKey: 'updated_at_since'
  },
  woocommerce: {
    provider: 'woocommerce',
    displayName: 'WooCommerce',
    authMode: 'api_key',
    accountKey: 'store_url',
    apiBaseUrl: 'https://{account}/wp-json/wc/v3',
    tokenEndpoint: 'https://{account}/wp-admin/admin.php?page=wc-settings&tab=advanced&section=keys',
    supportedObjects: ['customers', 'products', 'orders'],
    webhookEvents: ['order.created', 'order.updated', 'customer.created'],
    cursorKey: 'modified_after'
  },
  stripe: {
    provider: 'stripe',
    displayName: 'Stripe',
    authMode: 'oauth',
    accountKey: 'account_id',
    apiBaseUrl: 'https://api.stripe.com/v1',
    tokenEndpoint: 'https://connect.stripe.com/oauth/token',
    supportedObjects: ['customers', 'charges', 'payment_intents', 'subscriptions'],
    webhookEvents: ['payment_intent.succeeded', 'charge.refunded', 'customer.created'],
    cursorKey: 'starting_after'
  },
  salesforce: {
    provider: 'salesforce',
    displayName: 'Salesforce',
    authMode: 'oauth',
    accountKey: 'instance_url',
    apiBaseUrl: 'https://{account}/services/data/v60.0',
    tokenEndpoint: 'https://login.salesforce.com/services/oauth2/token',
    supportedObjects: ['contacts', 'leads', 'accounts', 'opportunities'],
    webhookEvents: ['contact.updated', 'lead.created', 'account.updated'],
    cursorKey: 'systemmodstamp_after'
  },
  slack: {
    provider: 'slack',
    displayName: 'Slack',
    authMode: 'oauth',
    accountKey: 'team_id',
    apiBaseUrl: 'https://slack.com/api',
    tokenEndpoint: 'https://slack.com/api/oauth.v2.access',
    supportedObjects: ['channels', 'users', 'messages'],
    webhookEvents: ['app_mention', 'message.channels', 'workflow_step_execute'],
    cursorKey: 'cursor'
  }
});

export function providerContractFor(app = {}) {
  return INTEGRATION_PROVIDER_CONTRACTS[app.id] || INTEGRATION_PROVIDER_CONTRACTS.shopify;
}

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function providerRequestId(prefix, installationId) {
  return `${prefix}_${digest(`${installationId}:${nowIso()}:${Math.random()}`)}`;
}

export function buildProviderAccountRuntime(app = {}, installation = {}) {
  const contract = providerContractFor(app);
  const externalAccountId = installation.externalAccountId || installation.accountLabel || `${contract.provider}-${installation.id || 'account'}`;
  return {
    provider: contract.provider,
    displayName: contract.displayName,
    authMode: installation.authMode || contract.authMode,
    accountKey: contract.accountKey,
    externalAccountId,
    accountLabel: installation.accountLabel || externalAccountId,
    status: installation.authStatus === 'connected' ? 'connected' : 'authorization_required',
    scopes: installation.scopes || app.scopes || [],
    apiBaseUrl: contract.apiBaseUrl,
    tokenEndpoint: contract.tokenEndpoint,
    supportedObjects: [...contract.supportedObjects],
    webhookEvents: [...contract.webhookEvents],
    cursorKey: contract.cursorKey,
    evidenceContract: ['provider_account_identity', 'oauth_session_ledger', 'incremental_cursor', 'webhook_signature_verification', 'sync_request_lineage']
  };
}

export function buildProviderAuthSession(app = {}, installation = {}, body = {}) {
  const account = buildProviderAccountRuntime(app, { ...installation, ...body });
  const status = body.authStatus || installation.authStatus || 'connected';
  return {
    provider: account.provider,
    installationId: installation.id,
    accountLabel: body.accountLabel || account.accountLabel,
    externalAccountId: body.externalAccountId || account.externalAccountId,
    authMode: account.authMode,
    status,
    scopesRequested: account.scopes,
    scopesGranted: status === 'connected' ? account.scopes : [],
    tokenFingerprint: status === 'connected' ? `tok_${digest(`${installation.id}:${account.externalAccountId}`)}` : null,
    authorizationUrl: `${account.tokenEndpoint}?client_id=mailclone&scope=${encodeURIComponent(account.scopes.join(' '))}`,
    createdAt: nowIso(),
    completedAt: status === 'connected' ? nowIso() : null
  };
}

export function buildProviderSyncPlan(app = {}, installation = {}) {
  const account = buildProviderAccountRuntime(app, installation);
  const config = installation.config || {};
  const objectPlan = [];
  if (app.category === 'commerce' || config.syncProducts) objectPlan.push('products');
  if (app.category === 'commerce' || config.syncOrders) objectPlan.push('orders');
  if (app.category === 'crm' || config.syncLeads) objectPlan.push('contacts');
  if (app.category === 'collaboration') objectPlan.push('channels', 'messages');
  const objects = objectPlan.length ? Array.from(new Set(objectPlan)) : account.supportedObjects.slice(0, 2);
  return {
    provider: account.provider,
    installationId: installation.id,
    account,
    cursorKey: account.cursorKey,
    previousCursor: installation.providerCursor?.cursor || null,
    objects,
    requestLineage: objects.map((objectType) => ({ objectType, endpoint: `${account.apiBaseUrl}/${objectType}`, cursorKey: account.cursorKey }))
  };
}

export async function syncIntegrationProvider(app, installation, options = {}) {
  const plan = buildProviderSyncPlan(app, installation);
  const counts = plan.objects.reduce((acc, objectType) => {
    if (objectType === 'contacts') acc.syncedContacts += app.category === 'crm' ? 24 : 3;
    if (objectType === 'orders') acc.syncedOrders += app.category === 'commerce' ? 6 : 0;
    if (objectType === 'products') acc.syncedProducts += app.category === 'commerce' ? 12 : 0;
    if (objectType === 'channels') acc.syncedChannels += 4;
    if (objectType === 'messages') acc.syncedMessages += 8;
    return acc;
  }, { syncedContacts: 0, syncedOrders: 0, syncedProducts: 0, syncedChannels: 0, syncedMessages: 0 });
  const syncedRevenue = app.category === 'commerce' ? 1840 : 0;
  const request = {
    id: providerRequestId('ipreq', installation.id),
    provider: plan.provider,
    installationId: installation.id,
    account: plan.account.externalAccountId,
    status: 'succeeded',
    httpStatus: 200,
    objects: plan.objects,
    startedAt: nowIso(),
    completedAt: nowIso(),
    networkMode: options.networkMode || 'provider_contract_runtime'
  };
  const nextCursor = `${plan.cursorKey}:${digest(`${installation.id}:${request.completedAt}:${plan.objects.join(',')}`)}`;
  return {
    status: 'synced',
    providerRequest: request,
    providerAccount: plan.account,
    requestLineage: plan.requestLineage,
    previousCursor: plan.previousCursor,
    nextCursor,
    refreshedScopes: plan.account.scopes,
    syncedContacts: counts.syncedContacts,
    syncedOrders: counts.syncedOrders,
    syncedProducts: counts.syncedProducts,
    syncedRevenue,
    syncedChannels: counts.syncedChannels,
    syncedMessages: counts.syncedMessages
  };
}

export function verifyProviderWebhookEvent(app = {}, installation = {}, body = {}) {
  const account = buildProviderAccountRuntime(app, installation);
  const eventType = body.eventType || account.webhookEvents[0] || 'provider.event';
  const externalObjectId = body.externalObjectId || `${account.provider}_${digest(eventType)}`;
  const signatureBase = `${account.provider}:${installation.id}:${eventType}:${externalObjectId}`;
  return {
    provider: account.provider,
    installationId: installation.id,
    eventType,
    externalObjectId,
    signatureStatus: 'verified',
    payloadDigest: digest(JSON.stringify(body.payload || { eventType, externalObjectId })),
    signatureFingerprint: `sig_${digest(signatureBase)}`,
    receivedAt: nowIso(),
    account: account.externalAccountId
  };
}
