import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const memoryManifest = JSON.parse(await readFile(new URL('./openclaw.plugin.json', import.meta.url), 'utf8'));
const routeManifest = JSON.parse(await readFile(new URL('../cortex-route-gate/openclaw.plugin.json', import.meta.url), 'utf8'));
const PRODUCTION_SCOPE = {
  scopeCredentialId: 'schema-credential',
  scopeHmacSecret: 'schema-scope-secret',
  writeToken: 'schema-write-token',
};
const SHARED_SESSION_SECRET = ' shared bytes are preserved ';

function validates(value, schema) {
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.anyOf && !schema.anyOf.some((option) => validates(value, option))) return false;
  if (schema.type === 'object' || schema.properties || schema.required) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (schema.required?.some((key) => !(key in value))) return false;
  }
  if (schema.additionalProperties === false && Object.keys(value).some((key) => !(key in schema.properties))) return false;
  if (schema.properties && !Object.entries(value).every(([key, candidate]) => {
    const property = schema.properties[key];
    if (!property) return true;
    if (property.type === 'string' && typeof candidate !== 'string') return false;
    if (property.type === 'boolean' && typeof candidate !== 'boolean') return false;
    if (property.const !== undefined && candidate !== property.const) return false;
    if (property.minLength !== undefined && candidate.length < property.minLength) return false;
    if (property.pattern !== undefined && !new RegExp(property.pattern).test(candidate)) return false;
    return true;
  })) return false;
  return true;
}

test('memory bridge schema rejects default-on continuity without a provisioned session secret', () => {
  const schema = memoryManifest.configSchema;
  assert.equal(validates({}, schema), false);
  assert.equal(validates({ ...PRODUCTION_SCOPE, enabledCodecContinuity: true }, schema), false);
  assert.equal(validates({ ...PRODUCTION_SCOPE, enabledCodecContinuity: false }, schema), false, 'memory_search still requires principal identity');
  assert.equal(validates({ ...PRODUCTION_SCOPE, sessionIdentityHmacSecret: '' }, schema), false);
  assert.equal(validates({ ...PRODUCTION_SCOPE, sessionIdentityHmacSecret: '   ' }, schema), false);
  assert.equal(validates({ ...PRODUCTION_SCOPE, sessionIdentityHmacSecret: SHARED_SESSION_SECRET }, schema), true);
});

test('production plugin schemas require complete scope credentials', () => {
  for (const schema of [memoryManifest.configSchema, routeManifest.configSchema]) {
    assert.equal(validates({ sessionIdentityHmacSecret: SHARED_SESSION_SECRET }, schema), false);
    assert.equal(validates({ sessionIdentityHmacSecret: SHARED_SESSION_SECRET, scopeCredentialId: 'schema-credential' }, schema), false);
    assert.equal(validates({ sessionIdentityHmacSecret: SHARED_SESSION_SECRET, scopeHmacSecret: 'schema-scope-secret' }, schema), false);
    assert.equal(validates({ sessionIdentityHmacSecret: SHARED_SESSION_SECRET, ...PRODUCTION_SCOPE }, schema), true);
  }
});

test('unsigned local development is explicit, default-off, and restricted to cortex-local/default', () => {
  for (const schema of [memoryManifest.configSchema, routeManifest.configSchema]) {
    assert.equal(validates({ sessionIdentityHmacSecret: SHARED_SESSION_SECRET, allowUnsignedLocalDevelopment: false }, schema), false);
    assert.equal(validates({ sessionIdentityHmacSecret: SHARED_SESSION_SECRET, allowUnsignedLocalDevelopment: true }, schema), true);
    assert.equal(validates({ sessionIdentityHmacSecret: SHARED_SESSION_SECRET, allowUnsignedLocalDevelopment: true, tenantId: 'cortex-local', workspaceId: 'default' }, schema), true);
    assert.equal(validates({ sessionIdentityHmacSecret: SHARED_SESSION_SECRET, allowUnsignedLocalDevelopment: true, tenantId: 'production' }, schema), false);
    assert.equal(schema.properties.allowUnsignedLocalDevelopment.type, 'boolean');
  }
});

test('shared secret and scope credential fields preserve secure schema constraints', () => {
  for (const manifest of [memoryManifest, routeManifest]) {
    assert.equal(manifest.configSchema.properties.sessionIdentityHmacSecret.pattern, '\\S');
    assert.equal(manifest.configSchema.properties.scopeHmacSecret.pattern, '\\S');
    assert.match('schema-credential', new RegExp(manifest.configSchema.properties.scopeCredentialId.pattern));
    assert.equal(manifest.uiHints.scopeHmacSecret.sensitive, true);
    assert.equal(manifest.uiHints.sessionIdentityHmacSecret.sensitive, true);
    assert.match(manifest.uiHints.sessionIdentityHmacSecret.help, /exact same secret/);
    assert.match(manifest.uiHints.allowUnsignedLocalDevelopment.help, /Defaults off/);
  }
});

test('production plugin schemas require a write token and advertise the Compose endpoint', () => {
  for (const manifest of [memoryManifest, routeManifest]) {
    const config = { sessionIdentityHmacSecret: SHARED_SESSION_SECRET, ...PRODUCTION_SCOPE };
    assert.equal(validates(config, manifest.configSchema), true);
    assert.equal(validates({ ...config, writeToken: '' }, manifest.configSchema), false);
    assert.equal(manifest.uiHints.baseUrl.placeholder, 'http://127.0.0.1:8888');
  }
});

test('plugin schemas accept the deprecated configured-user no-op and reject unknown configuration', () => {
  for (const manifest of [memoryManifest, routeManifest]) {
    const config = {
      sessionIdentityHmacSecret: SHARED_SESSION_SECRET,
      ...PRODUCTION_SCOPE,
    };
    const legacyProperty = manifest.configSchema.properties.preferConfiguredUserId;
    assert.equal(legacyProperty.type, 'boolean');
    assert.equal(legacyProperty.deprecated, true);
    assert.match(legacyProperty.description, /compatibility no-op/);
    assert.equal(validates({ ...config, preferConfiguredUserId: true }, manifest.configSchema), true);
    assert.equal(validates({ ...config, preferConfiguredUserId: false }, manifest.configSchema), true);
    assert.equal(validates({ ...config, preferConfiguredUserId: 'true' }, manifest.configSchema), false);
    assert.equal(validates({ ...config, configuredUserPrecedence: true }, manifest.configSchema), false);
  }
});
