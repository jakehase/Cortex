import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import register from './index.ts';

const manifest = JSON.parse(await readFile(new URL('./openclaw.plugin.json', import.meta.url), 'utf8'));
const runtimeSource = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
const schema = manifest.configSchema;

// OpenClaw config schemas use this JSON Schema subset for plugin configuration.
function validateConfig(value, candidateSchema = schema) {
  if (candidateSchema.const !== undefined && value !== candidateSchema.const) return false;
  if (candidateSchema.anyOf && !candidateSchema.anyOf.some((option) => validateConfig(value, option))) return false;
  if (candidateSchema.type === 'object' || candidateSchema.properties || candidateSchema.required) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (candidateSchema.required?.some((key) => !(key in value))) return false;
  }
  if (candidateSchema.additionalProperties === false) {
    if (Object.keys(value).some((key) => !(key in candidateSchema.properties))) return false;
  }
  if (candidateSchema.properties && !Object.entries(value).every(([key, candidate]) => {
    const property = candidateSchema.properties[key];
    if (!property) return true;
    if (property.type === 'number' && (typeof candidate !== 'number' || !Number.isFinite(candidate))) return false;
    if (property.type === 'string' && typeof candidate !== 'string') return false;
    if (property.type === 'boolean' && typeof candidate !== 'boolean') return false;
    if (property.const !== undefined && candidate !== property.const) return false;
    if (property.minimum !== undefined && candidate < property.minimum) return false;
    if (property.maximum !== undefined && candidate > property.maximum) return false;
    if (property.minLength !== undefined && candidate.length < property.minLength) return false;
    if (property.pattern !== undefined && !new RegExp(property.pattern).test(candidate)) return false;
    return true;
  })) return false;
  return true;
}

const SHARED_SESSION_SECRET = 'explicitly-provisioned-shared-test-secret';
const PRODUCTION_SCOPE = {
  scopeCredentialId: 'route-schema-credential',
  scopeHmacSecret: 'route-schema-secret',
  writeToken: 'route-schema-write-token',
};
const productionConfig = (overrides = {}) => ({ sessionIdentityHmacSecret: SHARED_SESSION_SECRET, ...PRODUCTION_SCOPE, ...overrides });

test('enabled route-gate production configuration requires session and scope credentials', () => {
  assert.equal(validateConfig({}), false);
  assert.equal(validateConfig({ enabled: true }), false);
  assert.equal(validateConfig({ enabled: false }), true);
  assert.equal(validateConfig({ enabled: true, ...PRODUCTION_SCOPE, sessionIdentityHmacSecret: '' }), false);
  assert.equal(validateConfig({ enabled: true, ...PRODUCTION_SCOPE, sessionIdentityHmacSecret: '   ' }), false);
  assert.equal(validateConfig({ enabled: true, sessionIdentityHmacSecret: SHARED_SESSION_SECRET }), false);
  assert.equal(validateConfig(productionConfig({ enabled: true })), true);
  assert.throws(() => registerHarness({ enabled: true, ...PRODUCTION_SCOPE }), /keyed session identity secret/);
  assert.throws(() => registerHarness({ enabled: true, sessionIdentityHmacSecret: SHARED_SESSION_SECRET }), /requires scopeCredentialId and scopeHmacSecret/);
  assert.doesNotThrow(() => registerHarness({ enabled: false }));
});

function registerHarness(config) {
  const api = { config, logger: { info() {}, warn() {} }, on() {} };
  return register(api);
}

test('route-gate rejects partial credentials and restricts the explicit unsigned escape hatch', () => {
  for (const config of [
    { sessionIdentityHmacSecret: SHARED_SESSION_SECRET, scopeCredentialId: 'route-schema-credential' },
    { sessionIdentityHmacSecret: SHARED_SESSION_SECRET, scopeHmacSecret: 'route-schema-secret' },
    { sessionIdentityHmacSecret: SHARED_SESSION_SECRET, scopeCredentialId: 'route-schema-credential', scopeHmacSecret: '   ' },
  ]) {
    assert.equal(validateConfig(config), false);
    assert.throws(() => registerHarness(config), /scopeCredentialId and scopeHmacSecret together/);
  }
  assert.equal(validateConfig({ sessionIdentityHmacSecret: SHARED_SESSION_SECRET, allowUnsignedLocalDevelopment: false }), false);
  assert.equal(validateConfig({ sessionIdentityHmacSecret: SHARED_SESSION_SECRET, allowUnsignedLocalDevelopment: true }), true);
  assert.doesNotThrow(() => registerHarness({ sessionIdentityHmacSecret: SHARED_SESSION_SECRET, allowUnsignedLocalDevelopment: true }));
  assert.equal(validateConfig({ sessionIdentityHmacSecret: SHARED_SESSION_SECRET, allowUnsignedLocalDevelopment: true, tenantId: 'production' }), false);
  assert.throws(
    () => registerHarness({ sessionIdentityHmacSecret: SHARED_SESSION_SECRET, allowUnsignedLocalDevelopment: true, tenantId: 'production' }),
    /restricted to the cortex-local\/default scope/,
  );
});

test('route-gate validates scope credential identifiers during registration', () => {
  const invalid = productionConfig({ scopeCredentialId: 'invalid credential' });
  assert.equal(validateConfig(invalid), false);
  assert.throws(() => registerHarness(invalid), /bounded opaque identifier/);
});

test('existing provisioned route-gate configuration remains valid', () => {
  assert.equal(validateConfig({
    baseUrl: 'http://127.0.0.1:18888',
    enabled: true,
    requireRouting: true,
    sessionIdentityHmacSecret: SHARED_SESSION_SECRET,
    ...PRODUCTION_SCOPE,
    writeToken: 'secret',
    writeTokenHeader: 'x-cortex-write-token',
    timeoutMs: 8000,
    maxRoutingPromptBytes: 262_144,
    maxLevels: 10,
    creativityGovernorEnabled: true,
    creativityHistorySize: 24,
    creativityQuarantineTerms: 8,
    oracleSessionQuarantineEnabled: false,
    oracleSessionResetBytes: 500_000,
    oracleSessionDir: '/tmp/openclaw-sessions',
    stateDir: '/tmp/cortex-route-gate',
  }), true);
});

test('write authorization configuration is exposed and the token is sensitive', () => {
  assert.equal(validateConfig(productionConfig({ writeToken: 'secret', writeTokenHeader: 'x-custom-token' })), true);
  assert.equal(validateConfig(productionConfig({ writeToken: '' })), false);
  assert.equal(manifest.uiHints.writeToken.sensitive, true);
  assert.throws(
    () => registerHarness(productionConfig({ writeToken: '' })),
    /requires writeToken outside explicit unsigned local development/,
  );
  assert.match(runtimeSource, /http:\/\/127\.0\.0\.1:8888/);
  assert.equal(manifest.uiHints.baseUrl.placeholder, 'http://127.0.0.1:8888');
});

for (const [name, minimum, defaultValue, maximum] of [
  ['maxCachedPlanAgeMs', 1_000, 300_000, 86_400_000],
  ['maxResponseBytes', 1_024, 1_048_576, 16_777_216],
]) {
  test(`${name} accepts its minimum, runtime default, and maximum`, () => {
    assert.match(runtimeSource, new RegExp(`cfg\\.${name}, ${defaultValue.toLocaleString('en-US').replaceAll(',', '_')}`));
    for (const value of [minimum, defaultValue, maximum]) {
      assert.equal(validateConfig(productionConfig({ [name]: value })), true, `${name}=${value}`);
    }
  });

  test(`${name} rejects unsafe bounds and wrong types`, () => {
    for (const value of [0, -1, maximum + 1, String(defaultValue), null, true]) {
      assert.equal(validateConfig(productionConfig({ [name]: value })), false, `${name}=${String(value)}`);
    }
  });
}

test('route-gate schema accepts the deprecated configured-user no-op and rejects unknown configuration', () => {
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.preferConfiguredUserId, {
    type: 'boolean',
    deprecated: true,
    description: 'Deprecated compatibility no-op. Trusted callback identity remains authoritative; configured userId is fallback-only.',
  });
  assert.equal(validateConfig(productionConfig({ preferConfiguredUserId: true })), true);
  assert.equal(validateConfig(productionConfig({ preferConfiguredUserId: false })), true);
  assert.equal(validateConfig(productionConfig({ preferConfiguredUserId: 'true' })), false);
  assert.equal(validateConfig(productionConfig({ maxCachedPlanAgeMS: 300_000 })), false);
  assert.equal(validateConfig(productionConfig({ maxResponseByte: 1_048_576 })), false);
});

test('oversized Oracle session archival is declared and explicitly opt-in', () => {
  assert.equal(validateConfig({
    oracleSessionQuarantineEnabled: true,
    sessionIdentityHmacSecret: SHARED_SESSION_SECRET,
    ...PRODUCTION_SCOPE,
    oracleSessionResetBytes: 500_000,
    oracleSessionDir: '/var/lib/openclaw/sessions',
  }), true);
  assert.equal(validateConfig(productionConfig({ oracleSessionResetBytes: 1023 })), false);
  assert.equal(manifest.uiHints.oracleSessionQuarantineEnabled.advanced, true);
});
