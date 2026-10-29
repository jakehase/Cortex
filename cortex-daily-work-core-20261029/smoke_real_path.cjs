'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createJiti } = require('/opt/openclaw-preastra-restore/2026.7.1-2/runtime/openclaw/node_modules/jiti/lib/jiti.cjs');

const configPath = '/opt/openclaw-preastra-restore/2026.7.1-2/state/openclaw.json';
const everydayStatePath = '/app/config/state/everyday_intel/decisions.jsonl';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const entry = config.plugins?.entries?.['cortex-route-gate'];
assert.equal(entry?.enabled, true, 'cortex-route-gate must be enabled');

const pluginRoot = (config.plugins?.load?.paths || []).find((candidate) => path.basename(candidate) === 'cortex-route-gate');
assert.ok(pluginRoot, 'configured cortex-route-gate source path is missing');
const pluginSource = path.join(pluginRoot, 'index.ts');
const jiti = createJiti(__filename, { interopDefault: true, moduleCache: false });
const imported = jiti(pluginSource);
const plugin = imported.default || imported;

const tools = [];
const api = {
  pluginConfig: entry.config,
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  on() {},
  registerTool(factory, options) { tools.push({ factory, options }); },
  async sendUserMessage() { throw new Error('real-path read smoke must never send a user message'); },
};
if (typeof plugin === 'function') plugin(api);
else plugin.register(api);

const registration = tools.find((row) => row.options?.names?.includes('cortex_daily_work'));
assert.ok(registration, 'cortex_daily_work is not registered by the configured plugin source');
const ownerSenderId = String(entry.config?.ownerSenderId || '').trim();
assert.ok(ownerSenderId, 'configured owner sender binding is required');
const smokeId = `daily-work-real-path-${Date.now()}`;
const tool = registration.factory({
  sessionKey: `agent:main:whatsapp:direct:${smokeId}`,
  sessionId: smokeId,
  senderId: ownerSenderId,
  requesterSenderId: ownerSenderId,
  userId: ownerSenderId,
  channel: 'whatsapp',
  messageChannel: 'whatsapp',
  channelId: 'whatsapp',
  agentId: 'main',
  messageId: smokeId,
});
assert.equal(tool?.name, 'cortex_daily_work');

function stateSnapshot(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, sha256: null, bytes: 0 };
  const body = fs.readFileSync(filePath);
  return {
    exists: true,
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    bytes: body.length,
  };
}

(async () => {
  const before = stateSnapshot(everydayStatePath);
  const raw = await tool.execute('daily-work-real-path-smoke', {
    action: 'attention_view',
    includeCandidates: false,
    includeResolved: false,
  });
  const after = stateSnapshot(everydayStatePath);
  assert.deepEqual(after, before, 'read-only attention_view changed the canonical everyday decisions state');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.provider, 'cortex-everyday');
  assert.equal(parsed.endpoint, '/everyday/attention/view');
  assert.equal(parsed.data?.success, true);
  assert.equal(typeof parsed.data?.counts, 'object');
  assert.equal(parsed.data?.policy?.candidate_is_not_an_obligation, true);
  assert.equal(parsed.data?.policy?.active_requires_explicit_confirmation, true);
  assert.equal(parsed.data?.policy?.external_actions, 'never authorized by attention state');
  process.stdout.write(JSON.stringify({
    schemaVersion: 'cortex.daily-work.real-path-smoke.v1',
    passed: true,
    action: 'attention_view',
    endpoint: parsed.endpoint,
    provider: parsed.provider,
    configuredPluginSource: pluginSource,
    response: {
      success: true,
      counts: parsed.data.counts,
      policy: parsed.data.policy,
    },
    canonicalStateUnchanged: true,
    canonicalStateBefore: before,
    canonicalStateAfter: after,
    externalSendInvoked: false,
    policyBypassInvoked: false,
  }, null, 2));
})().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
