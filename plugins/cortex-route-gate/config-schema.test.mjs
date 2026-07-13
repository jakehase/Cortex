import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('./openclaw.plugin.json', import.meta.url), 'utf8'));
const runtimeSource = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
const schema = manifest.configSchema;

// OpenClaw config schemas use this JSON Schema subset for plugin configuration.
function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (schema.additionalProperties === false) {
    if (Object.keys(value).some((key) => !(key in schema.properties))) return false;
  }
  return Object.entries(value).every(([key, candidate]) => {
    const property = schema.properties[key];
    if (property.type === 'number' && (typeof candidate !== 'number' || !Number.isFinite(candidate))) return false;
    if (property.type === 'string' && typeof candidate !== 'string') return false;
    if (property.type === 'boolean' && typeof candidate !== 'boolean') return false;
    if (property.minimum !== undefined && candidate < property.minimum) return false;
    if (property.maximum !== undefined && candidate > property.maximum) return false;
    if (property.minLength !== undefined && candidate.length < property.minLength) return false;
    return true;
  });
}

test('existing route-gate configuration remains valid', () => {
  assert.equal(validateConfig({}), true);
  assert.equal(validateConfig({
    baseUrl: 'http://127.0.0.1:18888',
    enabled: true,
    requireRouting: true,
    timeoutMs: 8000,
    maxLevels: 10,
    creativityGovernorEnabled: true,
    creativityHistorySize: 24,
    creativityQuarantineTerms: 8,
    stateDir: '/tmp/cortex-route-gate',
  }), true);
});

for (const [name, minimum, defaultValue, maximum] of [
  ['maxCachedPlanAgeMs', 1_000, 300_000, 86_400_000],
  ['maxResponseBytes', 1_024, 1_048_576, 16_777_216],
]) {
  test(`${name} accepts its minimum, runtime default, and maximum`, () => {
    assert.match(runtimeSource, new RegExp(`cfg\\.${name}, ${defaultValue.toLocaleString('en-US').replaceAll(',', '_')}`));
    for (const value of [minimum, defaultValue, maximum]) {
      assert.equal(validateConfig({ [name]: value }), true, `${name}=${value}`);
    }
  });

  test(`${name} rejects unsafe bounds and wrong types`, () => {
    for (const value of [0, -1, maximum + 1, String(defaultValue), null, true]) {
      assert.equal(validateConfig({ [name]: value }), false, `${name}=${String(value)}`);
    }
  });
}

test('route-gate schema continues to reject unknown configuration', () => {
  assert.equal(schema.additionalProperties, false);
  assert.equal(validateConfig({ maxCachedPlanAgeMS: 300_000 }), false);
  assert.equal(validateConfig({ maxResponseByte: 1_048_576 }), false);
});
