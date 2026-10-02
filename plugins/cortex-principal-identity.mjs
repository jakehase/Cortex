import { createHmac } from 'node:crypto';

const SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

function firstNonblank(...values) {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized) return normalized;
  }
  return '';
}

/**
 * Normalize only identity supplied by the trusted OpenClaw callback/factory.
 * Configuration remains separate so callers cannot accidentally reverse the
 * callback-first precedence contract while assembling an intermediate object.
 */
export function captureTrustedPrincipalContext(context = {}, fallback = {}) {
  const callbackSenderId = firstNonblank(context?.senderId, context?.requesterSenderId);
  const fallbackSenderId = firstNonblank(fallback?.senderId, fallback?.requesterSenderId);
  return Object.freeze({
    sessionKey: firstNonblank(context?.sessionKey, context?.sessionId),
    // senderId/requesterSenderId are the only callback fields that establish a
    // sender.  A generic callback userId is deliberately not promoted into a
    // sender identity.  Session-only native callbacks may instead use a fixed
    // sender supplied by trusted plugin configuration.
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

/**
 * An owner binding may fill in a sender only when the callback supplies no
 * contradictory identity. A callback userId is not strong enough to establish
 * sender identity, but an explicit foreign value is still evidence that the
 * configured owner fallback must not be applied.
 */
export function assertOwnerBoundFallbackIdentity(config = {}, context = {}) {
  const ownerSender = firstNonblank(config?.ownerSenderId);
  if (!ownerSender) return;
  const callbackSender = firstNonblank(context?.senderId, context?.requesterSenderId);
  const callbackUser = firstNonblank(context?.userId);
  const ownerUser = firstNonblank(config?.userId);
  if (!callbackSender && callbackUser && callbackUser !== ownerUser && callbackUser !== ownerSender) {
    throw new Error('owner-bound Cortex scope rejects a callback user without trusted sender identity');
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
  const callback = captureTrustedPrincipalContext(context, {
    senderId: firstNonblank(config?.ownerSenderId, config?.userId),
    userId: config?.userId,
    channelId: config?.channelId,
    agentId: config?.agentId,
  });
  if (callback.senderConflict) {
    throw new Error('canonical Cortex principal requires an unambiguous trusted sender');
  }
  const secret = String(config?.sessionIdentityHmacSecret ?? '');
  if (!secret.trim()) {
    throw new Error('sessionIdentityHmacSecret is required for canonical Cortex session identity');
  }
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
    user_id: callback.senderId && callback.senderId === String(config?.ownerSenderId ?? "").trim()
      ? firstNonblank(config?.userId)
      : SCOPE_ID_PATTERN.test(callback.userId)
        ? callback.userId
        : callback.userId
          ? `openclaw-opaque-user-${createHmac("sha256", secret).update("cortex.principal.user.v1\n", "utf8").update(callback.userId, "utf8").digest("hex")}`
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
  // Derive from the original context.  Re-feeding the normalized object would
  // mistake a configured fallback sender for callback evidence and erase a
  // trusted callback userId on generic (non-owner-bound) deployments.
  const execution = deriveCortexPrincipal(config, context);
  const ownerSender = String(config?.ownerSenderId ?? '').trim();
  if (trusted.senderConflict || !trusted.senderId) throw new Error('knowledge scope requires an unambiguous trusted sender');
  if (ownerSender && trusted.senderId !== ownerSender) {
    throw new Error('knowledge scope rejects a sender outside the configured owner binding');
  }
  if (!ownerSender || trusted.senderId !== ownerSender || execution.channel_id !== 'whatsapp') return execution;
  const secret = String(config.sessionIdentityHmacSecret);
  return Object.freeze({
    ...execution,
    user_id: String(config.userId),
    session_id: `openclaw-${createHmac('sha256', secret).update(`cortex.owner.memory.v1\n${ownerSender}`, 'utf8').digest('hex')}`,
  });
}
