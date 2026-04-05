import { saveDb } from './storage.mjs';
import { createId, nowIso, parseCookies, sha256 } from './utils.mjs';

export const SESSION_COOKIE_NAME = 'mailclone_session';
export const SESSION_TTL_MS = Number(process.env.MAILCLONE_SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 7);
export const SESSION_TOUCH_WINDOW_MS = Number(process.env.MAILCLONE_SESSION_TOUCH_WINDOW_MS || 1000 * 60 * 15);
export const PASSWORD_RESET_TTL_MS = Number(process.env.MAILCLONE_PASSWORD_RESET_TTL_MS || 1000 * 60 * 30);
export const INVITE_TTL_MS = Number(process.env.MAILCLONE_INVITE_TTL_MS || 1000 * 60 * 60 * 24 * 7);

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

function ensureSecurityCollections(state) {
  state.db.sessions ||= [];
  state.db.passwordResets ||= [];
  state.db.rateLimits ||= [];
  state.db.jobDeadLetters ||= [];
  state.db.invitations ||= [];
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

  for (const invite of state.db.invitations) {
    if (invite.status === 'pending' && isExpiredAt(invite.expiresAt)) {
      invite.status = 'expired';
      invite.expiredAt = nowIso();
      changed = true;
    }
  }

  if (changed) saveDb(state.db);
}

export function createSession(state, user, req, { reason = 'login' } = {}) {
  ensureSecurityCollections(state);
  const session = {
    id: createId('sess'),
    userId: user.id,
    createdAt: nowIso(),
    lastSeenAt: nowIso(),
    expiresAt: isoAfter(SESSION_TTL_MS),
    ip: requestIp(req),
    userAgent: String(req?.headers?.['user-agent'] || ''),
    reason
  };
  state.db.sessions.push(session);
  saveDb(state.db);
  return session;
}

function maybeTouchSession(state, session) {
  const lastSeenMs = new Date(session.lastSeenAt || session.createdAt || Date.now()).getTime();
  if (Date.now() - lastSeenMs < SESSION_TOUCH_WINDOW_MS) return;
  session.lastSeenAt = nowIso();
  session.expiresAt = isoAfter(SESSION_TTL_MS);
  saveDb(state.db);
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
    saveDb(state.db);
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
  saveDb(state.db);
  return sessionId;
}

export function revokeUserSessions(state, userId, { exceptSessionId = null, reason = 'manual-revocation' } = {}) {
  ensureSecurityCollections(state);
  let changed = false;
  for (const session of state.db.sessions) {
    if (session.userId !== userId || session.id === exceptSessionId || session.revokedAt) continue;
    session.revokedAt = nowIso();
    session.revokedReason = reason;
    changed = true;
  }
  if (changed) saveDb(state.db);
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
  saveDb(state.db);
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
  saveDb(state.db);
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
    saveDb(state.db);
    return null;
  }
  return reset;
}

export function createInvitationExpiry() {
  return isoAfter(INVITE_TTL_MS);
}
