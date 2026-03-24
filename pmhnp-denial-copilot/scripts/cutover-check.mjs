import { startOperationalServer } from '../src/ops/operationalHttpServerCli.mjs';

const livePublicBase = process.env.PMHNP_PUBLIC_APP_BASE || 'https://pmhnpbilling.com';
const liveApiBase = process.env.PMHNP_PUBLIC_API_BASE || 'https://api.pmhnpbilling.com';
const zombieBase = process.env.PMHNP_ZOMBIE_BASE || 'http://127.0.0.1:18087';

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const checks = [];
function sanitize(details) {
  if (!details || typeof details !== 'object') return details;
  const clone = JSON.parse(JSON.stringify(details));
  if (clone.body && typeof clone.body === 'object' && clone.body.token) {
    clone.body.token = '[redacted]';
  }
  return clone;
}
function record(name, ok, details) {
  checks.push({ name, ok, details: sanitize(details) });
}

const liveClientSession = await fetchJson(new URL('/client/session', livePublicBase));
record('live public /client/session unauthenticated', liveClientSession.status === 401, liveClientSession);

const liveClientSnapshot = await fetchJson(new URL('/client/snapshot', livePublicBase));
record('live public /client/snapshot unauthenticated', liveClientSnapshot.status === 401, liveClientSnapshot);

const liveHealth = await fetchJson(new URL('/health', liveApiBase));
record('live public /health', liveHealth.status === 200 && liveHealth.body?.ok === true, liveHealth);

const zombieTlsGate = await fetchJson(new URL('/client/session', zombieBase));
record('zombie runtime TLS gate', zombieTlsGate.status === 403 && zombieTlsGate.body?.error === 'OPERATIONAL_API_TLS_REQUIRED', zombieTlsGate);

const zombiePostTls = await fetchJson(new URL('/client/session', zombieBase), {
  headers: { 'x-forwarded-proto': 'https' }
});
record('zombie runtime post-TLS auth gate', zombiePostTls.status === 401, zombiePostTls);

const server = startOperationalServer({
  port: 0,
  clientToken: 'cutover-client-token',
  operationalToken: 'cutover-ops-token',
  security: {
    require_forwarded_tls: true,
    enforce_operational_auth: true,
    require_actor_headers: true
  },
  authConfig: {
    signing_secret: 'cutover-signing-secret',
    client_login_key: 'cutover-client-key',
    reviewer_login_key: 'cutover-reviewer-key',
    admin_login_key: 'cutover-admin-key',
    token_ttl_seconds: 3600,
    allow_legacy_static_tokens: false
  },
  healthConfig: {
    minimal_public_response: true
  }
});
await new Promise((resolve) => server.once('listening', resolve));

try {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  const recoveredBase = `http://127.0.0.1:${port}`;

  const recoveredHealth = await fetchJson(new URL('/health', recoveredBase));
  record('recovered strict /health minimal', recoveredHealth.status === 200 && Object.keys(recoveredHealth.body || {}).length === 1 && recoveredHealth.body?.ok === true, recoveredHealth);

  const recoveredTlsGate = await fetchJson(new URL('/client/session', recoveredBase));
  record('recovered strict TLS gate', recoveredTlsGate.status === 403 && recoveredTlsGate.body?.error === 'OPERATIONAL_API_TLS_REQUIRED', recoveredTlsGate);

  const recoveredClientLogin = await fetchJson(new URL('/v1/auth/client/login', recoveredBase), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-proto': 'https'
    },
    body: JSON.stringify({ access_key: 'cutover-client-key', actor_id: 'cutover-client-user' })
  });
  record('recovered strict client login', recoveredClientLogin.status === 200 && Boolean(recoveredClientLogin.body?.token), recoveredClientLogin);

  const recoveredOpsLogin = await fetchJson(new URL('/v1/auth/ops/login', recoveredBase), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-proto': 'https'
    },
    body: JSON.stringify({ access_key: 'cutover-admin-key', actor_id: 'cutover-admin-user' })
  });
  record('recovered strict ops login', recoveredOpsLogin.status === 200 && Boolean(recoveredOpsLogin.body?.token), recoveredOpsLogin);
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const ok = checks.every((item) => item.ok);
console.log(JSON.stringify({ ok, checks }, null, 2));
process.exit(ok ? 0 : 1);
