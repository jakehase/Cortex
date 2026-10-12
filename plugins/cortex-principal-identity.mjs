import { createHmac, timingSafeEqual } from 'node:crypto';

const SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const DELEGATION_VERSION = 'cortex.trusted-delegation.v1';
const DELEGATION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TRUSTED_SESSIONS = 4096;
const trustedParents = new Map();
const delegatedSessions = new Map();
const delegationWaiters = new Map();

function firstNonblank(...values) {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function explicitSender(context = {}) {
  return firstNonblank(context?.senderId, context?.requesterSenderId);
}

function signingSecret(config = {}) {
  const secret = String(config?.sessionIdentityHmacSecret ?? '');
  if (!secret.trim()) {
    throw new Error('sessionIdentityHmacSecret is required for canonical Cortex session identity');
  }
  return secret;
}

function registryNamespace(config = {}) {
  return createHmac('sha256', signingSecret(config))
    .update('cortex.delegation.registry.v1\n', 'utf8')
    .update(firstNonblank(config?.tenantId), 'utf8')
    .update('\0', 'utf8')
    .update(firstNonblank(config?.workspaceId), 'utf8')
    .digest('hex');
}

function registryKey(config, sessionKey) {
  return `${registryNamespace(config)}:${String(sessionKey)}`;
}

function trimRegistry(registry) {
  while (registry.size > MAX_TRUSTED_SESSIONS) {
    registry.delete(registry.keys().next().value);
  }
}

function canonicalEnvelopePayload(envelope) {
  return JSON.stringify({
    version: envelope.version,
    namespace: envelope.namespace,
    parent_session_key: envelope.parent_session_key,
    requester_session_key: envelope.requester_session_key,
    child_session_key: envelope.child_session_key,
    parent_context: envelope.parent_context,
    principal: envelope.principal,
    knowledge_principal: envelope.knowledge_principal,
    issued_at_ms: envelope.issued_at_ms,
    expires_at_ms: envelope.expires_at_ms,
  });
}

function signEnvelope(config, envelope) {
  return createHmac('sha256', signingSecret(config))
    .update('cortex.trusted-delegation.v1\n', 'utf8')
    .update(canonicalEnvelopePayload(envelope), 'utf8')
    .digest('hex');
}

function verifyEnvelope(config, envelope) {
  if (!envelope || envelope.version !== DELEGATION_VERSION) {
    throw new Error('trusted Cortex delegation envelope is missing or unsupported');
  }
  if (envelope.namespace !== registryNamespace(config)) {
    throw new Error('trusted Cortex delegation envelope belongs to another deployment scope');
  }
  if (!Number.isSafeInteger(envelope.expires_at_ms) || envelope.expires_at_ms <= Date.now()) {
    throw new Error('trusted Cortex delegation envelope has expired');
  }
  const supplied = Buffer.from(String(envelope.signature ?? ''), 'hex');
  const expected = Buffer.from(signEnvelope(config, envelope), 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error('trusted Cortex delegation envelope signature is invalid');
  }
  return envelope;
}

function notifyDelegationWaiters(key) {
  const waiters = delegationWaiters.get(key);
  if (!waiters) return;
  delegationWaiters.delete(key);
  for (const notify of waiters) notify();
}

/**
 * Normalize only identity supplied by the trusted OpenClaw callback/factory.
 * Configuration remains separate so callers cannot accidentally reverse the
 * callback-first precedence contract while assembling an intermediate object.
 */
export function captureTrustedPrincipalContext(context = {}, fallback = {}) {
  const callbackSenderId = explicitSender(context);
  const fallbackSenderId = firstNonblank(fallback?.senderId, fallback?.requesterSenderId);
  return Object.freeze({
    sessionKey: firstNonblank(context?.sessionKey, context?.sessionId),
    // senderId/requesterSenderId are the only callback fields that establish a
    // sender. A generic callback userId is deliberately not promoted into a
    // sender identity. Session-only native callbacks may use a fixed sender
    // only on deployments that do not declare an owner binding.
    senderId: firstNonblank(callbackSenderId, fallbackSenderId),
    senderConflict: Boolean(context?.senderConflict || (context?.senderId && context?.requesterSenderId && String(context.senderId).trim() !== String(context.requesterSenderId).trim())),
    userId: callbackSenderId
      ? callbackSenderId
      : firstNonblank(context?.userId, fallback?.userId, fallbackSenderId),
    // Native agent hooks expose the transport in channel and the conversation
    // in channelId. Older plugin factories expose only the canonical channelId.
    channelId: firstNonblank(context?.channel, context?.messageChannel, context?.channelId, fallback?.channelId),
    agentId: firstNonblank(context?.agentId, fallback?.agentId),
  });
}

/** Owner bindings require affirmative callback evidence; absence is not trust. */
export function assertOwnerBoundFallbackIdentity(config = {}, context = {}) {
  const ownerSender = firstNonblank(config?.ownerSenderId);
  if (!ownerSender) return;
  const callbackSender = explicitSender(context);
  if (!callbackSender) {
    throw new Error('owner-bound Cortex scope requires trusted callback sender identity');
  }
  if (context?.senderId && context?.requesterSenderId && String(context.senderId).trim() !== String(context.requesterSenderId).trim()) {
    throw new Error('owner-bound Cortex scope rejects conflicting callback sender identity');
  }
}

/**
 * Derive the canonical Cortex principal shared by route and memory plugins.
 * Tenant/workspace are deployment scope. Per-callback dimensions always win;
 * configured agent/user/channel values are fallbacks only. A configured global
 * session is deliberately never a fallback because it would merge independent
 * callback sessions.
 */
export function deriveCortexPrincipal(config = {}, context = {}) {
  assertOwnerBoundFallbackIdentity(config, context);
  const callback = captureTrustedPrincipalContext(context, {
    senderId: firstNonblank(config?.ownerSenderId, config?.userId),
    userId: config?.userId,
    channelId: config?.channelId,
    agentId: config?.agentId,
  });
  if (callback.senderConflict) {
    throw new Error('canonical Cortex principal requires an unambiguous trusted sender');
  }
  const secret = signingSecret(config);
  if (!callback.sessionKey) {
    throw new Error('canonical Cortex principal requires trusted callback session identity');
  }

  const sessionDigest = createHmac('sha256', secret)
    .update(callback.sessionKey, 'utf8')
    .digest('hex');
  const scope = {
    tenant_id: firstNonblank(config?.tenantId),
    workspace_id: firstNonblank(config?.workspaceId),
    agent_id: firstNonblank(callback.agentId, config?.agentId),
    user_id: callback.senderId && callback.senderId === String(config?.ownerSenderId ?? '').trim()
      ? firstNonblank(config?.userId)
      : SCOPE_ID_PATTERN.test(callback.userId)
        ? callback.userId
        : callback.userId
          ? `openclaw-opaque-user-${createHmac('sha256', secret).update('cortex.principal.user.v1\n', 'utf8').update(callback.userId, 'utf8').digest('hex')}`
          : `openclaw-unknown-user-${sessionDigest}`,
    channel_id: firstNonblank(callback.channelId, config?.channelId),
    session_id: `openclaw-${sessionDigest}`,
  };

  for (const [field, value] of Object.entries(scope)) {
    if (!SCOPE_ID_PATTERN.test(value)) {
      throw new Error(`${field} must be a complete bounded Cortex principal identifier`);
    }
  }
  return Object.freeze(scope);
}

/** Owner-search namespace only. Never use for Codec, route locks, output state. */
export function deriveCortexKnowledgePrincipal(config = {}, context = {}) {
  assertOwnerBoundFallbackIdentity(config, context);
  const trusted = captureTrustedPrincipalContext(context, {
    senderId: firstNonblank(config?.ownerSenderId, config?.userId),
    userId: config?.userId,
    channelId: config?.channelId,
    agentId: config?.agentId,
  });
  // Derive from the original context. Re-feeding the normalized object would
  // mistake a configured fallback sender for callback evidence and erase a
  // trusted callback userId on generic (non-owner-bound) deployments.
  const execution = deriveCortexPrincipal(config, context);
  const ownerSender = String(config?.ownerSenderId ?? '').trim();
  if (trusted.senderConflict || !trusted.senderId) throw new Error('knowledge scope requires an unambiguous trusted sender');
  if (ownerSender && trusted.senderId !== ownerSender) {
    throw new Error('knowledge scope rejects a sender outside the configured owner binding');
  }
  if (!ownerSender || trusted.senderId !== ownerSender || execution.channel_id !== 'whatsapp') return execution;
  const secret = signingSecret(config);
  return Object.freeze({
    ...execution,
    user_id: String(config.userId),
    session_id: `openclaw-${createHmac('sha256', secret).update(`cortex.owner.memory.v1\n${ownerSender}`, 'utf8').digest('hex')}`,
  });
}

/** Record a direct callback only when OpenClaw supplied affirmative sender evidence. */
export function rememberTrustedCortexPrincipalContext(config = {}, context = {}) {
  if (!explicitSender(context)) {
    throw new Error('trusted Cortex parent registration requires callback sender identity');
  }
  const normalized = captureTrustedPrincipalContext(context, {
    userId: config?.userId,
    channelId: config?.channelId,
    agentId: config?.agentId,
  });
  const principal = deriveCortexPrincipal(config, normalized);
  const knowledgePrincipal = deriveCortexKnowledgePrincipal(config, normalized);
  const record = Object.freeze({
    context: normalized,
    principal,
    knowledgePrincipal,
    delegated: false,
  });
  trustedParents.set(registryKey(config, normalized.sessionKey), record);
  trimRegistry(trustedParents);
  return record;
}

function delegatedRecord(config, context = {}) {
  const sessionKey = firstNonblank(context?.sessionKey, context?.sessionId, context?.childSessionKey);
  if (!sessionKey) return null;
  const key = registryKey(config, sessionKey);
  const envelope = delegatedSessions.get(key);
  if (!envelope) return null;
  try {
    verifyEnvelope(config, envelope);
  } catch (error) {
    delegatedSessions.delete(key);
    throw error;
  }
  if (envelope.child_session_key !== sessionKey) {
    throw new Error('trusted Cortex delegation child session does not match callback session');
  }
  const requesterSession = firstNonblank(context?.requesterSessionKey);
  if (requesterSession && requesterSession !== envelope.requester_session_key) {
    throw new Error('trusted Cortex delegation rejects mismatched requester session identity');
  }
  const sender = explicitSender(context);
  if (sender && sender !== envelope.parent_context.senderId) {
    throw new Error('trusted Cortex delegation rejects mismatched callback sender identity');
  }
  return Object.freeze({
    context: Object.freeze({ ...envelope.parent_context }),
    principal: Object.freeze({ ...envelope.principal }),
    knowledgePrincipal: Object.freeze({ ...envelope.knowledge_principal }),
    delegated: true,
    childSessionKey: sessionKey,
    requesterSessionKey: envelope.requester_session_key,
  });
}

/**
 * Resolve direct callbacks or locally registered, HMAC-sealed child sessions.
 * Caller-supplied envelope/principal fields are intentionally ignored.
 */
export function resolveTrustedCortexPrincipalContext(config = {}, context = {}) {
  const delegated = delegatedRecord(config, context);
  if (delegated) return delegated;
  if (explicitSender(context)) return rememberTrustedCortexPrincipalContext(config, context);
  const normalized = captureTrustedPrincipalContext(context, {
    senderId: config?.ownerSenderId ? '' : config?.userId,
    userId: config?.userId,
    channelId: config?.channelId,
    agentId: config?.agentId,
  });
  return Object.freeze({
    context: normalized,
    principal: deriveCortexPrincipal(config, context),
    knowledgePrincipal: deriveCortexKnowledgePrincipal(config, context),
    delegated: false,
  });
}

/** Wait briefly for subagent_spawned, which may race the child's first hook. */
export async function awaitTrustedCortexPrincipalContext(config = {}, context = {}, waitMs = 500) {
  try {
    return resolveTrustedCortexPrincipalContext(config, context);
  } catch (error) {
    if (explicitSender(context)) throw error;
    const sessionKey = firstNonblank(context?.sessionKey, context?.sessionId, context?.childSessionKey);
    if (!sessionKey || !Number.isFinite(waitMs) || waitMs <= 0) throw error;
    const key = registryKey(config, sessionKey);
    await new Promise((resolve) => {
      const waiters = delegationWaiters.get(key) ?? new Set();
      waiters.add(resolve);
      delegationWaiters.set(key, waiters);
      setTimeout(() => {
        waiters.delete(resolve);
        if (!waiters.size) delegationWaiters.delete(key);
        resolve();
      }, Math.min(1000, Math.max(1, Math.trunc(waitMs))));
    });
    return resolveTrustedCortexPrincipalContext(config, context);
  }
}

/** Seal the exact trusted parent principal/session for one native child session. */
export function registerTrustedCortexSubagentSession(config = {}, input = {}) {
  const childSessionKey = firstNonblank(input?.childSessionKey, input?.targetSessionKey);
  const requesterSessionKey = firstNonblank(input?.requesterSessionKey, input?.parentSessionKey);
  if (!childSessionKey || !requesterSessionKey) {
    throw new Error('trusted Cortex delegation requires child and requester session identity');
  }
  if (childSessionKey === requesterSessionKey) {
    throw new Error('trusted Cortex delegation requires distinct parent and child sessions');
  }
  const parent = delegatedRecord(config, { sessionKey: requesterSessionKey })
    ?? trustedParents.get(registryKey(config, requesterSessionKey));
  if (!parent) {
    throw new Error('trusted Cortex delegation requires a previously authenticated parent session');
  }
  const existingKey = registryKey(config, childSessionKey);
  const existing = delegatedSessions.get(existingKey);
  if (existing) {
    verifyEnvelope(config, existing);
    if (existing.requester_session_key !== requesterSessionKey || existing.parent_session_key !== parent.context.sessionKey) {
      throw new Error('trusted Cortex delegation rejects child session reassignment');
    }
    return delegatedRecord(config, { sessionKey: childSessionKey, requesterSessionKey });
  }
  const issuedAt = Date.now();
  const envelope = {
    version: DELEGATION_VERSION,
    namespace: registryNamespace(config),
    parent_session_key: parent.context.sessionKey,
    requester_session_key: requesterSessionKey,
    child_session_key: childSessionKey,
    parent_context: { ...parent.context },
    principal: { ...parent.principal },
    knowledge_principal: { ...parent.knowledgePrincipal },
    issued_at_ms: issuedAt,
    expires_at_ms: issuedAt + DELEGATION_TTL_MS,
  };
  envelope.signature = signEnvelope(config, envelope);
  delegatedSessions.set(existingKey, Object.freeze(envelope));
  trimRegistry(delegatedSessions);
  notifyDelegationWaiters(existingKey);
  return delegatedRecord(config, { sessionKey: childSessionKey, requesterSessionKey });
}
