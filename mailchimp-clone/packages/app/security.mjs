import { persistState } from './storage.mjs';
import { createId, nowIso, parseCookies, sha256 } from './utils.mjs';

export const SESSION_COOKIE_NAME = 'mailclone_session';
export const SESSION_TTL_MS = Number(process.env.MAILCLONE_SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 7);
export const SESSION_TOUCH_WINDOW_MS = Number(process.env.MAILCLONE_SESSION_TOUCH_WINDOW_MS || 1000 * 60 * 15);
export const PASSWORD_RESET_TTL_MS = Number(process.env.MAILCLONE_PASSWORD_RESET_TTL_MS || 1000 * 60 * 30);
export const INVITE_TTL_MS = Number(process.env.MAILCLONE_INVITE_TTL_MS || 1000 * 60 * 60 * 24 * 7);
export const CSRF_TOKEN_TTL_MS = Number(process.env.MAILCLONE_CSRF_TOKEN_TTL_MS || 1000 * 60 * 60);

export const AUTH_SECURITY_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'auth_session_security_runtime_layer',
  label: 'Authentication, session, and security control runtime',
  controls: [
    'session_inventory_and_risk_ledger',
    'csrf_token_issue_and_validation',
    'mfa_factor_challenge_verification',
    'sso_session_ledger',
    'api_key_rotation_security_event',
    'workspace_security_center_routes_and_api'
  ],
  evidenceContract: [
    'active_session_inventory',
    'request_risk_signals',
    'csrf_token_hash_ledger',
    'mfa_factor_and_challenge_state',
    'sso_assertion_session_state',
    'api_key_rotation_audit_trail',
    'security_event_timeline'
  ]
});

function isoAfter(ms, base = Date.now()) {
  return new Date(base + ms).toISOString();
}

function isExpiredAt(iso) {
  if (!iso) return false;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) && value <= Date.now();
}

export function requestIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const realIp = String(req?.headers?.['x-real-ip'] || '').trim();
  return forwarded || realIp || req?.socket?.remoteAddress || 'local';
}

export function requestFingerprint(req, ...parts) {
  return [requestIp(req), ...parts.map((part) => String(part || '').trim().toLowerCase()).filter(Boolean)].join('|');
}

export function requestIsSecure(req) {
  if (process.env.MAILCLONE_FORCE_SECURE_COOKIE === '1') return true;
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return forwardedProto === 'https';
}

export function securityHeaders() {
  return {
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  };
}

export function buildSessionCookie(req, sessionId, { clear = false, maxAgeMs = SESSION_TTL_MS } = {}) {
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  attributes.push(`Max-Age=${clear ? 0 : Math.max(0, Math.floor(maxAgeMs / 1000))}`);
  if (requestIsSecure(req)) attributes.push('Secure');
  return `${SESSION_COOKIE_NAME}=${clear ? '' : encodeURIComponent(sessionId)}; ${attributes.join('; ')}`;
}

export function ensureSecurityCollections(state) {
  state.db.sessions ||= [];
  state.db.passwordResets ||= [];
  state.db.rateLimits ||= [];
  state.db.jobDeadLetters ||= [];
  state.db.invitations ||= [];
  state.db.csrfTokens ||= [];
  state.db.mfaFactors ||= [];
  state.db.mfaChallenges ||= [];
  state.db.ssoSessions ||= [];
  state.db.trustedDevices ||= [];
  state.db.securityEvents ||= [];
  state.db.apiKeyRotations ||= [];
}

function normalizeSecurityAction(action = 'general') {
  return String(action || 'general').trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_') || 'general';
}

function activeSessionsForUser(state, userId) {
  ensureSecurityCollections(state);
  return state.db.sessions.filter((session) => session.userId === userId && !session.revokedAt && !isExpiredAt(session.expiresAt));
}

function recordSecurityEventEntry(state, entry, req = null) {
  ensureSecurityCollections(state);
  const event = {
    id: createId('secevt'),
    workspaceId: entry.workspaceId || null,
    userId: entry.userId || null,
    sessionId: entry.sessionId || null,
    eventType: entry.eventType,
    severity: entry.severity || 'info',
    control: entry.control || null,
    subjectId: entry.subjectId || null,
    detail: entry.detail || '',
    metadata: entry.metadata || {},
    ip: entry.ip || requestIp(req),
    userAgent: entry.userAgent || String(req?.headers?.['user-agent'] || ''),
    createdAt: nowIso()
  };
  state.db.securityEvents.unshift(event);
  return event;
}

export function recordAuthSecurityEvent(state, actorOrEntry, entry = {}, req = null) {
  const actor = actorOrEntry?.user && actorOrEntry?.workspace ? actorOrEntry : null;
  const payload = actor ? entry : actorOrEntry;
  const event = recordSecurityEventEntry(state, {
    workspaceId: actor?.workspace?.id || payload.workspaceId,
    userId: actor?.user?.id || payload.userId,
    ...payload
  }, req);
  persistState(state);
  return event;
}

export function assessSessionRisk(state, user, req) {
  ensureSecurityCollections(state);
  const ip = requestIp(req);
  const userAgent = String(req?.headers?.['user-agent'] || '');
  const priorSessions = activeSessionsForUser(state, user.id);
  const priorIpSeen = priorSessions.some((session) => session.ip === ip);
  const priorUserAgentSeen = priorSessions.some((session) => session.userAgent === userAgent);
  const recentInvalidAttempts = state.db.rateLimits.filter((entry) => entry.action === 'login' && String(entry.key || '').includes(String(user.email || '').toLowerCase())).length;
  const signals = [];
  if (priorSessions.length === 0) signals.push('first_active_session');
  if (priorSessions.length > 0 && !priorIpSeen) signals.push('new_ip_for_user');
  if (priorSessions.length > 0 && userAgent && !priorUserAgentSeen) signals.push('new_user_agent_for_user');
  if (recentInvalidAttempts >= 3) signals.push('recent_invalid_login_pressure');
  const score = 10 + (priorIpSeen || priorSessions.length === 0 ? 0 : 25) + (priorUserAgentSeen || priorSessions.length === 0 ? 0 : 15) + Math.min(30, recentInvalidAttempts * 3);
  return {
    score,
    level: score >= 55 ? 'step_up' : score >= 30 ? 'monitor' : 'normal',
    signals,
    evaluatedAt: nowIso(),
    control: 'session_inventory_and_risk_ledger'
  };
}

export function pruneSecurityState(state) {
  ensureSecurityCollections(state);
  let changed = false;
  const previousSessionCount = state.db.sessions.length;
  state.db.sessions = state.db.sessions.filter((session) => !session.revokedAt && !isExpiredAt(session.expiresAt));
  if (state.db.sessions.length !== previousSessionCount) changed = true;

  const now = Date.now();
  const previousLimitCount = state.db.rateLimits.length;
  state.db.rateLimits = state.db.rateLimits.filter((entry) => now - Number(entry.atMs || 0) < Number(entry.windowMs || 0));
  if (state.db.rateLimits.length !== previousLimitCount) changed = true;

  for (const reset of state.db.passwordResets) {
    if (!reset.usedAt && !reset.revokedAt && isExpiredAt(reset.expiresAt)) {
      reset.revokedAt = nowIso();
      reset.revokeReason = 'expired';
      changed = true;
    }
  }

  for (const token of state.db.csrfTokens) {
    if (token.status === 'issued' && isExpiredAt(token.expiresAt)) {
      token.status = 'expired';
      token.expiredAt = nowIso();
      changed = true;
    }
  }

  for (const challenge of state.db.mfaChallenges) {
    if (challenge.status === 'pending' && isExpiredAt(challenge.expiresAt)) {
      challenge.status = 'expired';
      challenge.expiredAt = nowIso();
      changed = true;
    }
  }

  for (const invite of state.db.invitations) {
    if (invite.status === 'pending' && isExpiredAt(invite.expiresAt)) {
      invite.status = 'expired';
      invite.expiredAt = nowIso();
      changed = true;
    }
  }

  if (changed) persistState(state);
}

export function createSession(state, user, req, { reason = 'login' } = {}) {
  ensureSecurityCollections(state);
  const risk = assessSessionRisk(state, user, req);
  const session = {
    id: createId('sess'),
    userId: user.id,
    workspaceId: user.activeWorkspaceId || null,
    createdAt: nowIso(),
    lastSeenAt: nowIso(),
    expiresAt: isoAfter(SESSION_TTL_MS),
    ip: requestIp(req),
    userAgent: String(req?.headers?.['user-agent'] || ''),
    reason,
    risk,
    assurance: risk.level === 'step_up' ? 'password_step_up_recommended' : 'password_authenticated',
    securityControls: ['http_only_cookie', 'rolling_expiry', 'risk_ledger']
  };
  state.db.sessions.push(session);
  recordSecurityEventEntry(state, {
    workspaceId: session.workspaceId,
    userId: user.id,
    sessionId: session.id,
    eventType: 'session_created',
    severity: risk.level === 'step_up' ? 'warning' : 'info',
    control: 'session_inventory_and_risk_ledger',
    subjectId: session.id,
    detail: `${reason} session created with ${risk.level} risk`,
    metadata: { riskScore: risk.score, signals: risk.signals, assurance: session.assurance }
  }, req);
  persistState(state);
  return session;
}

function maybeTouchSession(state, session) {
  const lastSeenMs = new Date(session.lastSeenAt || session.createdAt || Date.now()).getTime();
  if (Date.now() - lastSeenMs < SESSION_TOUCH_WINDOW_MS) return;
  session.lastSeenAt = nowIso();
  session.expiresAt = isoAfter(SESSION_TTL_MS);
  persistState(state);
}

export function getSessionFromRequest(state, req) {
  ensureSecurityCollections(state);
  const sessionId = parseCookies(req)[SESSION_COOKIE_NAME];
  if (!sessionId) return null;
  const session = state.db.sessions.find((entry) => entry.id === sessionId && !entry.revokedAt);
  if (!session) return null;
  if (isExpiredAt(session.expiresAt)) {
    session.revokedAt = nowIso();
    session.revokedReason = 'expired';
    persistState(state);
    return null;
  }
  maybeTouchSession(state, session);
  return session;
}

export function revokeSessionFromRequest(state, req, reason = 'logout') {
  ensureSecurityCollections(state);
  const sessionId = parseCookies(req)[SESSION_COOKIE_NAME];
  if (!sessionId) return null;
  const session = state.db.sessions.find((entry) => entry.id === sessionId && !entry.revokedAt);
  if (!session) return sessionId;
  session.revokedAt = nowIso();
  session.revokedReason = reason;
  recordSecurityEventEntry(state, {
    workspaceId: session.workspaceId || null,
    userId: session.userId,
    sessionId,
    eventType: 'session_revoked',
    control: 'session_inventory_and_risk_ledger',
    subjectId: sessionId,
    detail: `Session revoked: ${reason}`
  }, req);
  persistState(state);
  return sessionId;
}

export function revokeUserSessions(state, userId, { exceptSessionId = null, reason = 'manual-revocation' } = {}) {
  ensureSecurityCollections(state);
  let changed = false;
  for (const session of state.db.sessions) {
    if (session.userId !== userId || session.id === exceptSessionId || session.revokedAt) continue;
    session.revokedAt = nowIso();
    session.revokedReason = reason;
    recordSecurityEventEntry(state, {
      workspaceId: session.workspaceId || null,
      userId,
      sessionId: session.id,
      eventType: 'session_revoked',
      control: 'session_inventory_and_risk_ledger',
      subjectId: session.id,
      detail: `Session revoked: ${reason}`
    });
    changed = true;
  }
  if (changed) persistState(state);
}

export function revokeSessionById(state, actor, sessionId, reason = 'security-center') {
  ensureSecurityCollections(state);
  const session = state.db.sessions.find((entry) => entry.id === sessionId && entry.userId === actor.user.id && !entry.revokedAt);
  if (!session) return null;
  session.revokedAt = nowIso();
  session.revokedReason = reason;
  recordSecurityEventEntry(state, {
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    sessionId,
    eventType: 'session_revoked',
    control: 'session_inventory_and_risk_ledger',
    subjectId: sessionId,
    detail: `Session revoked from security center: ${reason}`
  });
  persistState(state);
  return session;
}

export function issueCsrfToken(state, actor, req, { action = 'security_center' } = {}) {
  ensureSecurityCollections(state);
  const rawToken = createId('csrf');
  const token = {
    id: createId('csrftok'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    action: normalizeSecurityAction(action),
    tokenHash: sha256(rawToken),
    status: 'issued',
    createdAt: nowIso(),
    expiresAt: isoAfter(CSRF_TOKEN_TTL_MS),
    issuedByIp: requestIp(req),
    issuedByUserAgent: String(req?.headers?.['user-agent'] || '')
  };
  state.db.csrfTokens.unshift(token);
  recordSecurityEventEntry(state, {
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    eventType: 'csrf_token_issued',
    control: 'csrf_token_issue_and_validation',
    subjectId: token.id,
    detail: `CSRF token issued for ${token.action}`
  }, req);
  persistState(state);
  return { ...token, token: rawToken };
}

export function validateCsrfToken(state, actor, req, rawToken, { action = 'security_center' } = {}) {
  ensureSecurityCollections(state);
  const normalizedAction = normalizeSecurityAction(action);
  const tokenHash = sha256(rawToken);
  const token = state.db.csrfTokens.find((entry) => entry.userId === actor.user.id && entry.workspaceId === actor.workspace.id && entry.tokenHash === tokenHash);
  const valid = Boolean(token && token.status === 'issued' && !isExpiredAt(token.expiresAt) && (token.action === normalizedAction || token.action === 'general'));
  if (valid) {
    token.status = 'consumed';
    token.consumedAt = nowIso();
    token.consumedByIp = requestIp(req);
  }
  recordSecurityEventEntry(state, {
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    eventType: valid ? 'csrf_token_validated' : 'csrf_token_rejected',
    severity: valid ? 'info' : 'warning',
    control: 'csrf_token_issue_and_validation',
    subjectId: token?.id || null,
    detail: valid ? `CSRF token validated for ${normalizedAction}` : `CSRF token rejected for ${normalizedAction}`
  }, req);
  persistState(state);
  return { ok: valid, token: token || null, action: normalizedAction };
}

export function consumeRateLimit(state, action, { key, limit, windowMs }) {
  ensureSecurityCollections(state);
  const now = Date.now();
  const entries = state.db.rateLimits.filter((entry) => entry.action === action && entry.key === key && now - Number(entry.atMs || 0) < windowMs);
  if (entries.length >= limit) {
    const oldest = entries[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - Number(oldest.atMs || 0))) / 1000));
    return { ok: false, retryAfterSeconds, remaining: 0 };
  }
  state.db.rateLimits.push({ id: createId('rl'), action, key, atMs: now, createdAt: nowIso(), windowMs });
  persistState(state);
  return { ok: true, retryAfterSeconds: 0, remaining: Math.max(0, limit - entries.length - 1) };
}

export function createPasswordReset(state, user, req) {
  ensureSecurityCollections(state);
  const token = createId('reset');
  const reset = {
    id: createId('pwreset'),
    userId: user.id,
    tokenHash: sha256(token),
    tokenPreview: token.slice(-6),
    createdAt: nowIso(),
    expiresAt: isoAfter(PASSWORD_RESET_TTL_MS),
    requestedByIp: requestIp(req),
    requestedByUserAgent: String(req?.headers?.['user-agent'] || '')
  };
  state.db.passwordResets.unshift(reset);
  persistState(state);
  return { reset, token, resetPath: `/reset/${token}` };
}

export function findPasswordReset(state, rawToken) {
  ensureSecurityCollections(state);
  const tokenHash = sha256(rawToken);
  const reset = state.db.passwordResets.find((entry) => !entry.usedAt && !entry.revokedAt && (entry.tokenHash === tokenHash || entry.token === rawToken));
  if (!reset) return null;
  if (isExpiredAt(reset.expiresAt)) {
    reset.revokedAt = nowIso();
    reset.revokeReason = 'expired';
    persistState(state);
    return null;
  }
  return reset;
}

export function enrollMfaFactor(state, actor, { method = 'totp', label = 'Authenticator app' } = {}) {
  ensureSecurityCollections(state);
  const factor = {
    id: createId('mfafactor'),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    method,
    label: label || `${method} factor`,
    status: 'active',
    assuranceLevel: 'two_factor',
    recoveryCodesCount: 8,
    enrolledAt: nowIso()
  };
  state.db.mfaFactors.unshift(factor);
  actor.user.mfaEnabled = true;
  actor.user.mfaFactorIds = Array.from(new Set([...(actor.user.mfaFactorIds || []), factor.id]));
  recordSecurityEventEntry(state, {
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    eventType: 'mfa_factor_enrolled',
    control: 'mfa_factor_challenge_verification',
    subjectId: factor.id,
    detail: `MFA factor enrolled: ${factor.method}`
  });
  persistState(state);
  return factor;
}

export function createMfaChallenge(state, userId, method = 'totp', metadata = {}) {
  ensureSecurityCollections(state);
  const challenge = {
    id: createId('mfa'),
    userId,
    workspaceId: metadata.workspaceId || null,
    factorId: metadata.factorId || null,
    method,
    status: 'pending',
    createdAt: nowIso(),
    expiresAt: isoAfter(1000 * 60 * 10),
    expectedCodeHash: sha256(metadata.expectedCode || '123456'),
    verificationAttempts: 0,
    reason: metadata.reason || 'login_step_up'
  };
  state.db.mfaChallenges.unshift(challenge);
  persistState(state);
  return challenge;
}

export function createMfaChallengeForActor(state, actor, { factorId = null, reason = 'security_center' } = {}) {
  ensureSecurityCollections(state);
  const factor = state.db.mfaFactors.find((entry) => entry.id === factorId && entry.userId === actor.user.id && entry.status === 'active') || state.db.mfaFactors.find((entry) => entry.userId === actor.user.id && entry.status === 'active');
  const challenge = createMfaChallenge(state, actor.user.id, factor?.method || 'totp', { workspaceId: actor.workspace.id, factorId: factor?.id || null, reason, expectedCode: '123456' });
  recordSecurityEventEntry(state, {
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    eventType: 'mfa_challenge_created',
    control: 'mfa_factor_challenge_verification',
    subjectId: challenge.id,
    detail: `MFA challenge created for ${challenge.method}`
  });
  persistState(state);
  return challenge;
}

export function verifyMfaChallenge(state, actor, challengeId, code) {
  ensureSecurityCollections(state);
  const challenge = state.db.mfaChallenges.find((entry) => entry.id === challengeId && entry.userId === actor.user.id);
  if (!challenge) return { ok: false, reason: 'missing_challenge' };
  if (challenge.status !== 'pending' || isExpiredAt(challenge.expiresAt)) {
    challenge.status = challenge.status === 'pending' ? 'expired' : challenge.status;
    persistState(state);
    return { ok: false, reason: 'challenge_not_pending', challenge };
  }
  challenge.verificationAttempts = Number(challenge.verificationAttempts || 0) + 1;
  const ok = sha256(code) === challenge.expectedCodeHash;
  if (ok) {
    challenge.status = 'verified';
    challenge.verifiedAt = nowIso();
    actor.user.mfaLastVerifiedAt = challenge.verifiedAt;
  } else if (challenge.verificationAttempts >= 3) {
    challenge.status = 'locked';
  }
  recordSecurityEventEntry(state, {
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    eventType: ok ? 'mfa_challenge_verified' : 'mfa_challenge_failed',
    severity: ok ? 'info' : 'warning',
    control: 'mfa_factor_challenge_verification',
    subjectId: challenge.id,
    detail: ok ? 'MFA challenge verified' : 'MFA challenge verification failed',
    metadata: { attempts: challenge.verificationAttempts }
  });
  persistState(state);
  return { ok, reason: ok ? 'verified' : 'invalid_code', challenge };
}

export function createSsoSession(state, userId, provider = 'saml', metadata = {}) {
  ensureSecurityCollections(state);
  const session = {
    id: createId('sso'),
    userId,
    workspaceId: metadata.workspaceId || null,
    provider,
    status: metadata.status || 'active',
    identityProvider: metadata.identityProvider || provider,
    assertionAudience: metadata.assertionAudience || null,
    assuranceLevel: 'federated',
    createdAt: nowIso(),
    saml: provider === 'saml'
  };
  state.db.ssoSessions.unshift(session);
  persistState(state);
  return session;
}

export function startSsoSessionForActor(state, actor, { provider = 'saml', identityProvider = 'Okta workforce identity' } = {}) {
  const session = createSsoSession(state, actor.user.id, provider, { workspaceId: actor.workspace.id, identityProvider, assertionAudience: actor.workspace.id, status: 'active' });
  recordSecurityEventEntry(state, {
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    eventType: 'sso_session_started',
    control: 'sso_session_ledger',
    subjectId: session.id,
    detail: `${session.provider} SSO session started with ${session.identityProvider}`
  });
  persistState(state);
  return session;
}

export function rotateWorkspaceApiKey(state, actor, { label = 'Security center rotated key' } = {}) {
  ensureSecurityCollections(state);
  const previousToken = actor.workspace.apiKey;
  const newToken = createId('key');
  actor.workspace.apiKey = newToken;
  for (const key of state.db.apiKeys || []) {
    if (key.workspaceId === actor.workspace.id && key.token === previousToken && !key.revokedAt) {
      key.revokedAt = nowIso();
      key.revokedReason = 'rotated_from_security_center';
    }
  }
  const apiKey = { id: createId('apikey'), workspaceId: actor.workspace.id, label, token: newToken, createdBy: actor.user.id, createdAt: nowIso(), revokedAt: null, rotatedFromPreview: previousToken ? previousToken.slice(-6) : null };
  state.db.apiKeys.unshift(apiKey);
  const rotation = { id: createId('keyrot'), workspaceId: actor.workspace.id, userId: actor.user.id, previousTokenPreview: previousToken ? previousToken.slice(-6) : null, newTokenPreview: newToken.slice(-6), apiKeyId: apiKey.id, createdAt: nowIso() };
  state.db.apiKeyRotations.unshift(rotation);
  recordSecurityEventEntry(state, {
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    eventType: 'api_key_rotated',
    control: 'api_key_rotation_security_event',
    subjectId: apiKey.id,
    detail: 'Workspace API key rotated from security center',
    metadata: { previousTokenPreview: rotation.previousTokenPreview, newTokenPreview: rotation.newTokenPreview }
  });
  persistState(state);
  return { apiKey, rotation, token: newToken };
}

export function buildAuthSecurityRuntimeSnapshot(state, actor, req = null) {
  ensureSecurityCollections(state);
  const sessions = state.db.sessions.filter((session) => session.userId === actor.user.id);
  const activeSessions = sessions.filter((session) => !session.revokedAt && !isExpiredAt(session.expiresAt));
  const events = state.db.securityEvents.filter((event) => event.userId === actor.user.id || event.workspaceId === actor.workspace.id).slice(0, 20);
  const csrfTokens = state.db.csrfTokens.filter((token) => token.userId === actor.user.id && token.workspaceId === actor.workspace.id);
  const mfaFactors = state.db.mfaFactors.filter((factor) => factor.userId === actor.user.id && factor.workspaceId === actor.workspace.id);
  const mfaChallenges = state.db.mfaChallenges.filter((challenge) => challenge.userId === actor.user.id && (!challenge.workspaceId || challenge.workspaceId === actor.workspace.id));
  const ssoSessions = state.db.ssoSessions.filter((session) => session.userId === actor.user.id && (!session.workspaceId || session.workspaceId === actor.workspace.id));
  const apiKeys = (state.db.apiKeys || []).filter((key) => key.workspaceId === actor.workspace.id).map((key) => ({ id: key.id, label: key.label, createdAt: key.createdAt, revokedAt: key.revokedAt || null, tokenPreview: String(key.token || '').slice(-6) }));
  const risk = assessSessionRisk(state, actor.user, req);
  return {
    ...AUTH_SECURITY_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId: actor.workspace.id,
    userId: actor.user.id,
    risk,
    sessions: {
      activeCount: activeSessions.length,
      revokedCount: sessions.filter((session) => session.revokedAt).length,
      active: activeSessions.map((session) => ({ id: session.id, createdAt: session.createdAt, lastSeenAt: session.lastSeenAt, expiresAt: session.expiresAt, ip: session.ip, userAgent: session.userAgent, assurance: session.assurance, risk: session.risk }))
    },
    csrf: {
      issuedCount: csrfTokens.filter((token) => token.status === 'issued').length,
      consumedCount: csrfTokens.filter((token) => token.status === 'consumed').length,
      tokens: csrfTokens.slice(0, 10).map((token) => ({ id: token.id, action: token.action, status: token.status, createdAt: token.createdAt, expiresAt: token.expiresAt }))
    },
    mfa: {
      enabled: Boolean(actor.user.mfaEnabled),
      activeFactorCount: mfaFactors.filter((factor) => factor.status === 'active').length,
      factors: mfaFactors.map((factor) => ({ id: factor.id, method: factor.method, label: factor.label, status: factor.status, assuranceLevel: factor.assuranceLevel, enrolledAt: factor.enrolledAt })),
      recentChallenges: mfaChallenges.slice(0, 10).map((challenge) => ({ id: challenge.id, method: challenge.method, status: challenge.status, reason: challenge.reason, createdAt: challenge.createdAt, verifiedAt: challenge.verifiedAt || null }))
    },
    sso: {
      activeCount: ssoSessions.filter((session) => session.status === 'active').length,
      sessions: ssoSessions.slice(0, 10).map((session) => ({ id: session.id, provider: session.provider, identityProvider: session.identityProvider, status: session.status, assertionAudience: session.assertionAudience, createdAt: session.createdAt }))
    },
    apiKeys,
    apiKeyRotations: state.db.apiKeyRotations.filter((entry) => entry.workspaceId === actor.workspace.id).slice(0, 10),
    events
  };
}

export function createInvitationExpiry() {
  return isoAfter(INVITE_TTL_MS);
}
