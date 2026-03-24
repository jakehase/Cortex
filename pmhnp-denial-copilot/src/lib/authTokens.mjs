import crypto from 'node:crypto';

function base64urlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlDecode(value) {
  const padded = `${value}`.replace(/-/g, '+').replace(/_/g, '/');
  const mod = padded.length % 4;
  const normalized = mod ? `${padded}${'='.repeat(4 - mod)}` : padded;
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function signInput(input, secret) {
  return crypto.createHmac('sha256', secret)
    .update(input)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function grantForAccessKey(accessKey, authConfig) {
  const key = String(accessKey || '').trim();
  if (!key) return null;

  if (timingSafeEqualText(key, authConfig.client_login_key)) {
    return { role: 'client', scopes: ['client'] };
  }
  if (timingSafeEqualText(key, authConfig.reviewer_login_key)) {
    return { role: 'reviewer', scopes: ['client', 'ops'] };
  }
  if (timingSafeEqualText(key, authConfig.admin_login_key)) {
    return { role: 'admin', scopes: ['client', 'ops', 'audit'] };
  }
  return null;
}

function defaultSubject(role, actorId) {
  return String(actorId || role || 'user').trim() || 'user';
}

export function issueAccessToken({ accessKey, actorId, authConfig, requestedScope } = {}) {
  const grant = grantForAccessKey(accessKey, authConfig);
  if (!grant) {
    return {
      ok: false,
      status: 401,
      error: 'AUTH_ACCESS_KEY_INVALID',
      message: 'Access key is invalid.'
    };
  }

  if (requestedScope && !grant.scopes.includes(requestedScope)) {
    return {
      ok: false,
      status: 403,
      error: 'AUTH_SCOPE_NOT_ALLOWED',
      message: `This access key cannot issue ${requestedScope} tokens.`
    };
  }

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + Math.max(60, Number(authConfig.token_ttl_seconds || 3600));
  const header = { alg: 'HS256', typ: 'PMHNP' };
  const payload = {
    sub: defaultSubject(grant.role, actorId),
    role: grant.role,
    scopes: grant.scopes,
    iat,
    exp,
    jti: `tok_${crypto.randomUUID().replace(/-/g, '')}`
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signature = signInput(`${encodedHeader}.${encodedPayload}`, authConfig.signing_secret);
  const token = `${encodedHeader}.${encodedPayload}.${signature}`;

  return {
    ok: true,
    status: 200,
    token,
    token_type: 'Bearer',
    role: payload.role,
    scopes: payload.scopes,
    actor_id: payload.sub,
    issued_at: new Date(iat * 1000).toISOString(),
    expires_at: new Date(exp * 1000).toISOString()
  };
}

export function verifyAccessToken(token, authConfig) {
  try {
    const [encodedHeader, encodedPayload, signature] = String(token || '').split('.');
    if (!encodedHeader || !encodedPayload || !signature) {
      return { ok: false, error: 'AUTH_TOKEN_FORMAT_INVALID' };
    }

    const expectedSignature = signInput(`${encodedHeader}.${encodedPayload}`, authConfig.signing_secret);
    if (!timingSafeEqualText(signature, expectedSignature)) {
      return { ok: false, error: 'AUTH_TOKEN_SIGNATURE_INVALID' };
    }

    const header = JSON.parse(base64urlDecode(encodedHeader));
    const payload = JSON.parse(base64urlDecode(encodedPayload));
    if (header.alg !== 'HS256' || header.typ !== 'PMHNP') {
      return { ok: false, error: 'AUTH_TOKEN_HEADER_INVALID' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || now >= payload.exp) {
      return { ok: false, error: 'AUTH_TOKEN_EXPIRED' };
    }

    return { ok: true, payload };
  } catch {
    return { ok: false, error: 'AUTH_TOKEN_PARSE_FAILED' };
  }
}

export function hasScopes(payload, scopes = []) {
  return scopes.every((scope) => Array.isArray(payload?.scopes) && payload.scopes.includes(scope));
}

export function hasRole(payload, roles = []) {
  return roles.length === 0 || roles.includes(payload?.role);
}
