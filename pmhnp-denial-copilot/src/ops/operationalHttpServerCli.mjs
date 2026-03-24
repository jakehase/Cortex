import { AUTH_CONFIG, HEALTH_CONFIG, OPERATIONAL_SECURITY } from '../config.mjs';
import { createServer } from '../http/createServer.mjs';

function shouldLogSensitiveStartup() {
  return /^(1|true|yes|on)$/i.test(String(process.env.PMHNP_LOG_SENSITIVE_STARTUP || '').trim());
}

export function startOperationalServer({
  port = Number(process.env.PORT || 18088),
  clientToken = process.env.PMHNP_CLIENT_PORTAL_TOKEN || 'dev-demo-token',
  operationalToken = process.env.PMHNP_OPERATIONAL_API_TOKEN || clientToken,
  security = OPERATIONAL_SECURITY,
  authConfig = AUTH_CONFIG,
  healthConfig = HEALTH_CONFIG
} = {}) {
  const server = createServer({ clientToken, operationalToken, security, authConfig, healthConfig });
  server.listen(port, () => {
    const address = server.address();
    const boundPort = typeof address === 'object' && address ? address.port : port;
    console.log(`PMHNP recovered dev server listening on http://127.0.0.1:${boundPort}`);
    if (shouldLogSensitiveStartup()) {
      console.log(`Client portal token: ${clientToken}`);
      console.log(`Operational API token: ${operationalToken}`);
    } else {
      console.log(`Client portal token: configured (${clientToken ? 'redacted' : 'unset'})`);
      console.log(`Operational API token: configured (${operationalToken ? 'redacted' : 'unset'})`);
    }
    console.log(`Operational route auth: ${security.enforce_operational_auth ? 'enabled' : 'disabled'}`);
    console.log(`Forwarded TLS gate: ${security.require_forwarded_tls ? 'enabled' : 'disabled'}`);
    console.log(`Minimal public health: ${healthConfig.minimal_public_response ? 'enabled' : 'disabled'}`);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startOperationalServer();
}
