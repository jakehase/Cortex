import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const memoryManifest = JSON.parse(await readFile(new URL('./openclaw.plugin.json', import.meta.url), 'utf8'));
const routeManifest = JSON.parse(await readFile(new URL('../cortex-route-gate/openclaw.plugin.json', import.meta.url), 'utf8'));

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
  assert.equal(validates({ enabledCodecContinuity: true }, schema), false);
  assert.equal(validates({ enabledCodecContinuity: false }, schema), false, 'memory_search still requires principal identity');
  assert.equal(validates({ sessionIdentityHmacSecret: '' }, schema), false);
  assert.equal(validates({ sessionIdentityHmacSecret: '   ' }, schema), false);
  assert.equal(validates({ sessionIdentityHmacSecret: 'explicit-shared-secret' }, schema), true);
});

test('one explicitly provisioned opaque value satisfies both plugin schemas', () => {
  const sharedSecret = ' shared bytes are preserved ';
  assert.equal(validates({ sessionIdentityHmacSecret: sharedSecret }, memoryManifest.configSchema), true);
  assert.equal(validates({ enabled: true, sessionIdentityHmacSecret: sharedSecret }, routeManifest.configSchema), true);
  for (const manifest of [memoryManifest, routeManifest]) {
    assert.equal(manifest.configSchema.properties.sessionIdentityHmacSecret.pattern, '\\S');
    assert.equal(manifest.uiHints.sessionIdentityHmacSecret.sensitive, true);
    assert.match(manifest.uiHints.sessionIdentityHmacSecret.help, /exact same secret/);
  }
});
