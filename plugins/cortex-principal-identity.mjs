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
  return Object.freeze({
    sessionKey: firstNonblank(context?.sessionKey, context?.sessionId),
    userId: firstNonblank(context?.userId, context?.requesterSenderId, fallback?.userId),
    channelId: firstNonblank(context?.channelId, context?.messageChannel, fallback?.channelId),
    agentId: firstNonblank(context?.agentId, fallback?.agentId),
  });
}

/**
 * Derive the canonical Cortex principal shared by route and memory plugins.
 * Tenant/workspace are deployment scope. Per-callback dimensions always win;
 * configured agent/user/channel values are fallbacks only. A configured global
 * session is deliberately never a fallback because it would merge independent
 * callback sessions.
 */
export function deriveCortexPrincipal(config = {}, context = {}) {
  const callback = captureTrustedPrincipalContext(context);
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
    user_id: firstNonblank(callback.userId, config?.userId),
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
