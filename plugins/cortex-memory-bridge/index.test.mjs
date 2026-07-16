import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';

import plugin, { DurableLifecycleSpool, ExpiringLruMap, durabilityScore, buildWriteThroughMetadata, lifecyclePersistenceKey, reconcileResults } from './index.ts';

const lifecycleConfig = (overrides = {}) => ({
  stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-test-')),
  tenantId: 'tenant-test',
  workspaceId: 'workspace-test',
  scopeCredentialId: 'bridge-test',
  scopeHmacSecret: 'scope-test-secret',
  sessionIdentityHmacSecret: 'session-test-secret',
  writeToken: 'memory-bridge-production-write-token',
  enabledCodecContinuity: false,
  ...overrides,
});
const lifecycleContext = (sessionKey, overrides = {}) => ({
  sessionKey,
  userId: 'local-user',
  channelId: 'local-channel',
  agentId: 'main',
  ...overrides,
});
const successfulCommitResponse = () => new Response(JSON.stringify({
  success: true,
  receipt: 'test-assurance-receipt',
  committed: true,
  durable_write: { status: 'stored' },
  assurance: { memory_commit: { eligible: true } },
}));
const lifecycleSpoolFiles = (stateDir) => {
  const root = path.join(stateDir, 'lifecycle-principals-v2');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((entry) => /^[0-9a-f]{64}$/.test(entry))
    .map((entry) => path.join(root, entry, 'lifecycle-spool.json'))
    .filter((entry) => fs.existsSync(entry));
};

const runSpoolWorker = (stateDir, operation, prefix, count) => new Promise((resolve, reject) => {
  const moduleUrl = new URL('./index.ts', import.meta.url).href;
  const script = `
    import { DurableLifecycleSpool } from ${JSON.stringify(moduleUrl)};
    const spool = new DurableLifecycleSpool(${JSON.stringify(stateDir)}, 512);
    const principal = { version: 1, tenant_id: 'tenant', workspace_id: 'workspace', scope_credential_id: 'credential', agent_id: 'agent', user_id: 'user', channel_id: 'channel', session_id: 'session' };
    for (let index = 0; index < ${count}; index += 1) {
      const key = ${JSON.stringify(prefix)} + index;
      if (${JSON.stringify(operation)} === 'ack') spool.ack(key);
      else spool.put({ version: 3, key, createdAt: new Date().toISOString(), principal, event: { result: key, messages: [] }, context: { sessionKey: 'session', sessionId: 'session', channelId: 'channel', agentId: 'agent', userId: 'user', idempotencyKey: key }, fallbackText: key });
    }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`spool worker exited ${code}: ${stderr}`)));
});

const runReceiptWorker = (stateDir, receipt) => new Promise((resolve, reject) => {
  const moduleUrl = new URL('./index.ts', import.meta.url).href;
  const resultPath = path.join(os.tmpdir(), `cortex-receipt-worker-${process.pid}-${Date.now()}-${Math.random()}`);
  const script = `
    import fs from 'node:fs';
    import { DurableLifecycleSpool } from ${JSON.stringify(moduleUrl)};
    const spool = new DurableLifecycleSpool(${JSON.stringify(stateDir)}, 512);
    fs.writeFileSync(${JSON.stringify(resultPath)}, spool.retainReceipt('shared-lifecycle', ${JSON.stringify(receipt)}));
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code !== 0) return reject(new Error(`receipt worker exited ${code}: ${stderr}`));
    try {
      resolve(fs.readFileSync(resultPath, 'utf8'));
    } finally {
      fs.rmSync(resultPath, { force: true });
    }
  });
});

const runEvalWorker = (script, label) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  child.on('error', reject);
  child.on('close', (code) => code === 0
    ? resolve()
    : reject(new Error(`${label} exited ${code}: ${stderr}`)));
});

test('registration rejects an unprovisioned shared session secret before hooks or lifecycle replay start', () => {
  for (const sessionIdentityHmacSecret of [undefined, '', '   ']) {
    let registrations = 0;
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-invalid-config-'));
    try {
      assert.throws(() => plugin.register({
        pluginConfig: {
          stateDir,
          ...(sessionIdentityHmacSecret === undefined ? {} : { sessionIdentityHmacSecret }),
        },
        logger: { info() {}, warn() {} },
        on() { registrations += 1; },
        registerMemoryRuntime() { registrations += 1; },
        registerTool() { registrations += 1; },
      }), /explicitly provisioned sessionIdentityHmacSecret/);
      assert.equal(registrations, 0);
      assert.deepEqual(fs.readdirSync(stateDir), [], 'registration failure must not create lifecycle state');
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }
});

test('registration rejects missing, partial, and invalid production scope credentials before side effects', () => {
  const cases = [
    [{}, /requires scopeCredentialId and scopeHmacSecret/],
    [{ scopeCredentialId: 'bridge-test' }, /scopeCredentialId and scopeHmacSecret together/],
    [{ scopeHmacSecret: 'scope-test-secret' }, /scopeCredentialId and scopeHmacSecret together/],
    [{ scopeCredentialId: 'bridge-test', scopeHmacSecret: '   ' }, /scopeCredentialId and scopeHmacSecret together/],
    [{ scopeCredentialId: 'invalid credential', scopeHmacSecret: 'scope-test-secret' }, /bounded opaque identifier/],
  ];
  for (const [scopeConfig, expected] of cases) {
    let registrations = 0;
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-invalid-scope-'));
    try {
      assert.throws(() => plugin.register({
        pluginConfig: { stateDir, sessionIdentityHmacSecret: 'session-test-secret', ...scopeConfig },
        logger: { info() {}, warn() {} },
        on() { registrations += 1; },
        registerMemoryRuntime() { registrations += 1; },
        registerTool() { registrations += 1; },
      }), expected);
      assert.equal(registrations, 0);
      assert.deepEqual(fs.readdirSync(stateDir), [], 'scope validation must precede lifecycle spool replay');
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }
});

test('unsigned local development requires an explicit opt-in and the default local scope', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-unsigned-local-'));
  try {
    assert.doesNotThrow(() => plugin.register({
      pluginConfig: {
        stateDir,
        sessionIdentityHmacSecret: 'session-test-secret',
        allowUnsignedLocalDevelopment: true,
        enabledCodecContinuity: false,
        enabledWriteThrough: false,
      },
      logger: { info() {}, warn() {} },
      on() {},
      registerMemoryRuntime() {},
      registerTool() {},
    }));
    assert.throws(() => plugin.register({
      pluginConfig: {
        stateDir,
        sessionIdentityHmacSecret: 'session-test-secret',
        allowUnsignedLocalDevelopment: true,
        tenantId: 'production',
      },
      logger: { info() {}, warn() {} },
      on() {},
      registerMemoryRuntime() {},
      registerTool() {},
    }), /restricted to the cortex-local\/default scope/);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('minimal production configuration signs memory_search and default-on agent_end continuity', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-minimal-production-'));
  const handlers = new Map();
  const requests = [];
  let searchFactory;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({
      path: new URL(String(url)).pathname,
      headers: new Headers(options?.headers),
      body: JSON.parse(String(options?.body || '{}')),
    });
    return String(url).endsWith('/knowledge/search')
      ? new Response('{"results":[],"search_mode":"semantic"}')
      : new Response('{"success":true}');
  };
  try {
    plugin.register({
      pluginConfig: {
        stateDir,
        scopeCredentialId: 'bridge-production-default',
        scopeHmacSecret: 'bridge-production-scope-secret',
        sessionIdentityHmacSecret: 'bridge-production-session-secret',
        writeToken: 'memory-bridge-production-write-token',
        retryCount: 0,
      },
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool(factory, options) {
        if (options?.names?.includes('memory_search')) searchFactory = factory;
      },
    });
    const context = { sessionKey: 'production-session', userId: 'production-user', channelId: 'production-channel', agentId: 'main' };
    await searchFactory(context).execute('production-search', { query: 'production memory' });
    handlers.get('llm_output')({ content: 'production continuity output' }, context);
    await handlers.get('agent_end')({}, context);

    assert.deepEqual(requests.map(({ path: requestPath }) => requestPath), ['/knowledge/search', '/nexus/codec/events']);
    for (const request of requests) {
      assert.equal(request.headers.get('x-cortex-tenant-id'), 'cortex-local');
      assert.equal(request.headers.get('x-cortex-workspace-id'), 'default');
      assert.equal(request.headers.get('x-cortex-scope-credential-id'), 'bridge-production-default');
      assert.match(request.headers.get('x-cortex-scope-signature'), /^[0-9a-f]{64}$/);
      assert.equal(request.body.scope_credential_id, 'bridge-production-default');
      assert.match(request.body.scope_signature, /^[0-9a-f]{64}$/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('lifecycle writes and memory_search recall remain isolated across trusted invocation contexts', async () => {
  const handlers = new Map();
  let searchFactory;
  const recordsByScope = new Map();
  const codecScopes = [];
  const searchScopes = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body || '{}'));
    const scopeKey = JSON.stringify(body.scope);
    if (String(url).endsWith('/nexus/codec/events')) {
      codecScopes.push(body.scope);
      recordsByScope.set(scopeKey, body.events[0].text);
      return new Response('{"success":true}');
    }
    if (String(url).endsWith('/knowledge/search')) {
      searchScopes.push(body.scope);
      const text = recordsByScope.get(scopeKey);
      return new Response(JSON.stringify({
        results: text ? [{
          id: `record-${searchScopes.length}`,
          path: `codec/${body.scope.session_id}`,
          text,
          score: 0.95,
          metadata: { source: 'curated-project-facts', quality: 'curated', scope: body.scope },
        }] : [],
        search_mode: 'semantic',
      }));
    }
    throw new Error(`unexpected endpoint ${url}`);
  };

  try {
    plugin.register({
      pluginConfig: lifecycleConfig({ enabledCodecContinuity: true, enabledWriteThrough: false, retryCount: 0 }),
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool(factory, options) {
        if (options?.names?.includes('memory_search')) searchFactory = factory;
      },
    });

    const sessions = [
      {
        hook: { sessionKey: 'session-alpha', userId: 'user-alpha', channelId: 'channel-alpha', agentId: 'agent-alpha' },
        tool: { sessionKey: 'session-alpha', requesterSenderId: 'user-alpha', messageChannel: 'channel-alpha', agentId: 'agent-alpha' },
        memory: 'Cobalt launch decision belongs only to session alpha.',
      },
      {
        hook: { sessionKey: 'session-beta', userId: 'user-beta', channelId: 'channel-beta', agentId: 'agent-beta' },
        tool: { sessionKey: 'session-beta', requesterSenderId: 'user-beta', messageChannel: 'channel-beta', agentId: 'agent-beta' },
        memory: 'Amber release decision belongs only to session beta.',
      },
    ];

    for (const entry of sessions) {
      handlers.get('llm_output')({ content: entry.memory }, entry.hook);
      await handlers.get('agent_end')({}, entry.hook);
    }

    const alpha = JSON.parse(await searchFactory(sessions[0].tool).execute('alpha-search', { query: 'cobalt launch decision' }));
    const beta = JSON.parse(await searchFactory(sessions[1].tool).execute('beta-search', { query: 'amber release decision' }));
    assert.match(alpha.results[0].snippet, /session alpha/);
    assert.doesNotMatch(alpha.results[0].snippet, /session beta/);
    assert.match(beta.results[0].snippet, /session beta/);
    assert.doesNotMatch(beta.results[0].snippet, /session alpha/);
    assert.deepEqual(searchScopes, codecScopes, 'tool reads use the exact lifecycle principal scopes');
    assert.notEqual(searchScopes[0].session_id, searchScopes[1].session_id);
    assert.equal(searchScopes[0].session_id, `openclaw-${createHmac('sha256', 'session-test-secret').update('session-alpha').digest('hex')}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('lifecycle hooks require a trusted session and use only configured fixed-principal fallbacks', async () => {
  const handlers = new Map();
  const requests = [];
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-missing-principal-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({
      path: new URL(String(url)).pathname,
      headers: new Headers(options?.headers),
      body: JSON.parse(String(options?.body || '{}')),
    });
    return successfulCommitResponse();
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({
        stateDir,
        enabledWriteThrough: true,
        minDurabilityScore: 0,
        sessionId: 'configured-session-must-not-be-used',
        userId: 'configured-user',
        channelId: 'configured-channel',
        agentId: 'configured-agent',
      }),
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });

    assert.throws(
      () => handlers.get('llm_output')({ content: 'must not use the configured global session' }, {}),
      /lifecycle callback requires trusted session identity/,
    );
    await assert.rejects(
      () => handlers.get('subagent_ended')({ result: 'must not persist' }, {}),
      /lifecycle callback requires trusted session identity/,
    );
    await assert.rejects(
      () => handlers.get('agent_end')({ result: 'must not persist' }, {}),
      /lifecycle callback requires trusted session identity/,
    );
    assert.equal(requests.length, 0);
    assert.deepEqual(lifecycleSpoolFiles(stateDir), []);

    const context = { sessionKey: 'trusted-lifecycle-session' };
    handlers.get('llm_output')({ content: 'durable output from the supported lifecycle hook shape' }, context);
    await handlers.get('agent_end')({
      messages: [{ role: 'user', content: 'Remember the supported lifecycle callback contract.' }],
    }, context);

    assert.deepEqual(requests.map(({ path: requestPath }) => requestPath), ['/nexus/assurance/receipt', '/nexus/commit']);
    const commit = requests[1];
    assert.equal(commit.body.metadata.scope.agent_id, 'configured-agent');
    assert.equal(commit.body.metadata.scope.user_id, 'configured-user');
    assert.equal(commit.body.metadata.scope.channel_id, 'configured-channel');
    assert.equal(
      commit.body.metadata.scope.session_id,
      `openclaw-${createHmac('sha256', 'session-test-secret').update(context.sessionKey).digest('hex')}`,
    );
    assert.equal(commit.headers.get('x-cortex-agent-id'), 'configured-agent');
    assert.equal(commit.headers.get('x-cortex-user-id'), 'configured-user');
    assert.equal(commit.headers.get('x-cortex-channel-id'), 'configured-channel');
    assert.deepEqual(lifecycleSpoolFiles(stateDir), []);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('memory_search fails closed without complete trusted factory identity and never contacts Cortex', async () => {
  let searchFactory;
  let fetched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched = true; return new Response('{"results":[]}'); };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig(),
      logger: { info() {}, warn() {} },
      on() {},
      registerMemoryRuntime() {},
      registerTool(factory, options) {
        if (options?.names?.includes('memory_search')) searchFactory = factory;
      },
    });
    const result = JSON.parse(await searchFactory({ sessionKey: 'only-a-session' }).execute('missing-principal', { query: 'private memory' }));
    assert.equal(result.disabled, true);
    assert.match(result.error, /trusted invocation context: missing userId, channelId, agentId/);
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('memory runtime manager binds and preserves trusted invocation identity', async () => {
  let memoryRuntime;
  let requestBody;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(String(options?.body || '{}'));
    return new Response('{"results":[],"search_mode":"semantic"}');
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig(),
      logger: { info() {}, warn() {} },
      on() {},
      registerMemoryRuntime(runtime) { memoryRuntime = runtime; },
      registerTool() {},
    });

    const unavailable = await memoryRuntime.getMemorySearchManager({ agentId: 'manager-agent' });
    assert.equal(unavailable.manager, null);
    assert.match(unavailable.error, /trusted invocation context: missing sessionKey, userId, channelId/);

    const available = await memoryRuntime.getMemorySearchManager({
      sessionKey: 'manager-session',
      requesterSenderId: 'manager-user',
      messageChannel: 'manager-channel',
      agentId: 'manager-agent',
    });
    assert.ok(available.manager);
    await available.manager.search('manager scoped recall', {
      sessionKey: 'untrusted-override-session',
      userId: 'untrusted-override-user',
    });
    assert.deepEqual(requestBody.scope, {
      tenant_id: 'tenant-test',
      workspace_id: 'workspace-test',
      agent_id: 'manager-agent',
      user_id: 'manager-user',
      channel_id: 'manager-channel',
      session_id: `openclaw-${createHmac('sha256', 'session-test-secret').update('manager-session').digest('hex')}`,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('memory POSTs attach the configured write-token header', async () => {
  const handlers = new Map();
  const originalFetch = globalThis.fetch;
  let headers;
  globalThis.fetch = async (_url, options) => {
    headers = new Headers(options?.headers);
    return successfulCommitResponse();
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({ enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0, writeToken: 'memory-secret', writeTokenHeader: 'x-memory-token' }),
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    handlers.get('llm_output')({ content: 'durable authorized lifecycle output' }, lifecycleContext('authorized-session'));
    await handlers.get('agent_end')({}, lifecycleContext('authorized-session'));
    assert.equal(headers.get('x-memory-token'), 'memory-secret');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('opted-in lifecycle mode uses Nexus assurance receipt, commit, and Codec continuity with scoped identity', async () => {
  const handlers = new Map();
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const request = { url: String(url), headers: new Headers(options?.headers), body: JSON.parse(String(options?.body || '{}')) };
    requests.push(request);
    return request.url.endsWith('/nexus/assurance/receipt')
      ? new Response('{"success":true,"receipt":"test-assurance-receipt"}')
      : request.url.endsWith('/nexus/commit')
        ? successfulCommitResponse()
        : new Response('{"success":true}');
  };
  try {
    plugin.register({
      pluginConfig: {
        stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-default-test-')),
        tenantId: 'tenant-default',
        workspaceId: 'workspace-default',
        scopeCredentialId: 'bridge-default',
        scopeHmacSecret: 'scope-default-secret',
        sessionIdentityHmacSecret: 'session-default-secret',
        writeToken: 'memory-bridge-production-write-token',
        minDurabilityScore: 0,
        retryCount: 0,
        enabledWriteThrough: true,
        enabledCodecContinuity: true,
      },
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const context = lifecycleContext('default-session', { channelId: 'test-channel' });
    handlers.get('llm_output')({ content: 'default mode durable lifecycle output' }, context);
    await handlers.get('agent_end')({
      messages: [{ role: 'user', content: 'Remember the verified deployment decision.' }],
    }, context);

    assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), ['/nexus/assurance/receipt', '/nexus/commit', '/nexus/codec/events']);
    const commit = requests[1];
    assert.equal(commit.body.query, 'Remember the verified deployment decision.');
    assert.match(commit.body.response, /default mode durable lifecycle output/);
    assert.equal(commit.body.metadata.quality, 'candidate');
    assert.equal(commit.body.metadata.assurance_status, 'unvalidated');
    assert.equal('validator_result' in commit.body.metadata, false);
    assert.deepEqual(commit.body.metadata.scope, {
      tenant_id: 'tenant-default',
      workspace_id: 'workspace-default',
      channel_id: 'test-channel',
      agent_id: 'main',
      user_id: 'local-user',
      session_id: `openclaw-${(await import('node:crypto')).createHmac('sha256', 'session-default-secret').update('default-session').digest('hex')}`,
    });
    assert.equal(commit.body.assurance_receipt, 'test-assurance-receipt');
    assert.match(commit.headers.get('x-cortex-scope-signature'), /^[0-9a-f]{64}$/);
    assert.equal(requests[2].body.tenant_id, 'tenant-default');
    assert.equal(requests[2].body.workspace_id, 'workspace-default');
    assert.equal(requests[2].body.scope_credential_id, 'bridge-default');
    assert.equal(requests[2].body.session_key, commit.body.metadata.scope.session_id);
    assert.match(requests[2].body.scope_signature, /^[0-9a-f]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('write-through requires canonical durable-write confirmation and retains output for retry', async () => {
  const handlers = new Map();
  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/nexus/assurance/receipt')) return successfulCommitResponse();
    requests += 1;
    return new Response(JSON.stringify({
      success: false,
      committed: false,
      durable_write: { status: 'write_failed' },
      assurance: { memory_commit: { eligible: true } },
    }));
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({ enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0 }),
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const context = lifecycleContext('truth-session');
    handlers.get('llm_output')({ content: 'durable output awaiting a truthful commit acknowledgment' }, context);

    await assert.rejects(() => handlers.get('agent_end')({}, context), /output retained for retry/);
    await assert.rejects(() => handlers.get('agent_end')({}, context), /output retained for retry/);
    assert.equal(requests, 2, 'a false acknowledgment is not deduplicated as completed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('write-through requests a new receipt only after Nexus proves expiry without commit', async () => {
  const handlers = new Map();
  const commits = [];
  let receiptRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/nexus/assurance/receipt')) {
      receiptRequests += 1;
      return new Response(JSON.stringify({ success: true, receipt: `server-receipt-${receiptRequests}` }));
    }
    const body = JSON.parse(String(options?.body || '{}'));
    commits.push(body);
    if (body.assurance_receipt === 'server-receipt-1') {
      return new Response(
        JSON.stringify({ detail: { error: 'assurance_receipt_expired_without_commit' } }),
        { status: 409 },
      );
    }
    return successfulCommitResponse();
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({ enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0 }),
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const context = lifecycleContext('expired-session');
    handlers.get('llm_output')({ content: 'durable output with an expired uncommitted receipt' }, context);
    await handlers.get('agent_end')({}, context);

    assert.equal(receiptRequests, 2);
    assert.deepEqual(commits.map((body) => body.assurance_receipt), ['server-receipt-1', 'server-receipt-2']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('write-through retains an expired receipt while Nexus reports unknown commit outcome', async () => {
  const handlers = new Map();
  let receiptRequests = 0;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-unknown-receipt-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/nexus/assurance/receipt')) {
      receiptRequests += 1;
      return new Response(JSON.stringify({ success: true, receipt: 'server-receipt-unknown' }));
    }
    return new Response(
      JSON.stringify({ detail: { error: 'assurance_receipt_commit_outcome_unknown' } }),
      { status: 409 },
    );
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({ stateDir, enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0 }),
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const context = lifecycleContext('unknown-session');
    handlers.get('llm_output')({ content: 'durable output whose commit outcome remains unknown' }, context);
    await assert.rejects(() => handlers.get('agent_end')({}, context), /output retained for retry/);
    const [spoolFile] = lifecycleSpoolFiles(stateDir);
    const [record] = JSON.parse(fs.readFileSync(spoolFile, 'utf8'));
    assert.equal(receiptRequests, 1);
    assert.equal(record.assuranceReceipt, 'server-receipt-unknown');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('failed lifecycle writes replay from the durable spool after plugin restart', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-restart-'));
  const config = lifecycleConfig({
    stateDir,
    enabledWriteThrough: true,
    minDurabilityScore: 0,
    retryCount: 0,
  });
  const originalFetch = globalThis.fetch;
  const requests = [];
  let receiptRequests = 0;
  let acceptCommit = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/nexus/assurance/receipt')) {
      receiptRequests += 1;
      return successfulCommitResponse();
    }
    requests.push({ headers: new Headers(options?.headers), body: JSON.parse(String(options?.body || '{}')) });
    return acceptCommit
      ? successfulCommitResponse()
      : new Response(JSON.stringify({ success: false, committed: false, durable_write: { status: 'write_failed' } }));
  };
  try {
    const firstHandlers = new Map();
    plugin.register({
      pluginConfig: config,
      logger: { info() {}, warn() {} },
      on(name, handler) { firstHandlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const context = lifecycleContext('restart-session');
    firstHandlers.get('llm_output')({ content: 'restart-safe durable lifecycle output' }, context);
    await assert.rejects(() => firstHandlers.get('agent_end')({}, context), /output retained for retry/);
    assert.equal('idempotency_key' in requests[0].body.metadata, false);
    assert.equal(requests[0].headers.get('x-cortex-scope-credential-id'), 'bridge-test');
    assert.match(requests[0].headers.get('x-cortex-scope-signature'), /^[0-9a-f]{64}$/);
    const spoolFiles = lifecycleSpoolFiles(stateDir);
    assert.equal(spoolFiles.length, 1);
    assert.match(path.basename(path.dirname(spoolFiles[0])), /^[0-9a-f]{64}$/);
    const pendingRecords = JSON.parse(fs.readFileSync(spoolFiles[0], 'utf8'));
    assert.equal(pendingRecords.length, 1);
    assert.equal(pendingRecords[0].version, 3);
    assert.equal(pendingRecords[0].assuranceReceipt, 'test-assurance-receipt');
    const firstKey = pendingRecords[0].key;
    assert.deepEqual(pendingRecords[0].principal, {
      version: 1,
      tenant_id: 'tenant-test',
      workspace_id: 'workspace-test',
      scope_credential_id: 'bridge-test',
      agent_id: 'main',
      user_id: 'local-user',
      channel_id: 'local-channel',
      session_id: `openclaw-${createHmac('sha256', 'session-test-secret').update('restart-session').digest('hex')}`,
    });
    assert.deepEqual(pendingRecords[0].context, {
      sessionKey: 'restart-session',
      sessionId: 'restart-session',
      channelId: 'local-channel',
      agentId: 'main',
      userId: 'local-user',
      idempotencyKey: firstKey,
    });

    acceptCommit = true;
    plugin.register({
      pluginConfig: config,
      logger: { info() {}, warn() {} },
      on() {},
      registerMemoryRuntime() {},
      registerTool() {},
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(requests.length, 2);
    assert.equal(receiptRequests, 1, 'restart reuses the durably retained server receipt');
    assert.equal(requests[1].body.assurance_receipt, requests[0].body.assurance_receipt);
    assert.equal('idempotency_key' in requests[1].body.metadata, false);
    assert.equal(requests[1].headers.get('x-cortex-scope-credential-id'), 'bridge-test');
    assert.match(requests[1].headers.get('x-cortex-scope-signature'), /^[0-9a-f]{64}$/);
    assert.equal(fs.existsSync(spoolFiles[0]), false, 'an acknowledged principal spool leaves no empty state directory behind');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('separate processes reuse the retained receipt after a durable commit response is lost', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-response-loss-'));
  const durableServerState = path.join(stateDir, 'simulated-durable-server.json');
  const moduleUrl = new URL('./index.ts', import.meta.url).href;
  const config = lifecycleConfig({
    stateDir,
    enabledWriteThrough: true,
    minDurabilityScore: 0,
    retryCount: 0,
  });
  // Exercise the supported lifecycle hook shape: session identity is dynamic,
  // while fixed agent/user/channel values come from the configured scope.
  delete config.agentId;
  delete config.userId;
  delete config.channelId;
  const context = { sessionKey: 'response-loss-session' };
  const firstScript = `
    import fs from 'node:fs';
    import plugin from ${JSON.stringify(moduleUrl)};
    const handlers = new Map();
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/nexus/assurance/receipt')) {
        return new Response(JSON.stringify({ success: true, receipt: 'durable-response-loss-receipt' }));
      }
      const request = JSON.parse(String(options?.body || '{}'));
      fs.writeFileSync(${JSON.stringify(durableServerState)}, JSON.stringify(request), { mode: 0o600 });
      throw new Error('ECONNRESET after durable commit');
    };
    plugin.register({
      pluginConfig: ${JSON.stringify(config)}, logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); }, registerMemoryRuntime() {}, registerTool() {},
    });
    const context = ${JSON.stringify(context)};
    handlers.get('llm_output')({ content: 'We decided to preserve the durable response-loss deployment.' }, context);
    try {
      await handlers.get('agent_end')({ messages: [{ role: 'user', content: 'Remember the durable response-loss decision.' }] }, context);
      process.exit(2);
    } catch (error) {
      if (!String(error).includes('output retained for retry')) process.exit(3);
    }
  `;
  const secondScript = `
    import fs from 'node:fs'; import path from 'node:path';
    import plugin from ${JSON.stringify(moduleUrl)};
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/nexus/assurance/receipt')) throw new Error('restart minted a second receipt');
      const request = JSON.parse(String(options?.body || '{}'));
      const committed = JSON.parse(fs.readFileSync(${JSON.stringify(durableServerState)}, 'utf8'));
      if (request.assurance_receipt !== committed.assurance_receipt) throw new Error('restart changed the durable receipt identity');
      return new Response(JSON.stringify({
        success: true, committed: true, durable_write: { status: 'stored' },
        assurance: { memory_commit: { eligible: true } },
      }));
    };
    plugin.register({
      pluginConfig: ${JSON.stringify(config)}, logger: { info() {}, warn() {} },
      on() {}, registerMemoryRuntime() {}, registerTool() {},
    });
    const root = path.join(${JSON.stringify(stateDir)}, 'lifecycle-principals-v2');
    const pending = () => fs.existsSync(root) && fs.readdirSync(root)
      .some((entry) => fs.existsSync(path.join(root, entry, 'lifecycle-spool.json')));
    const deadline = Date.now() + 4000;
    while (pending() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    if (pending()) process.exit(4);
  `;
  try {
    await runEvalWorker(firstScript, 'response-loss writer');
    const [spoolFile] = lifecycleSpoolFiles(stateDir);
    const [retained] = JSON.parse(fs.readFileSync(spoolFile, 'utf8'));
    const committed = JSON.parse(fs.readFileSync(durableServerState, 'utf8'));
    assert.equal(retained.assuranceReceipt, 'durable-response-loss-receipt');
    assert.equal(committed.assurance_receipt, retained.assuranceReceipt);

    await runEvalWorker(secondScript, 'response-loss restart');
    assert.equal(fs.existsSync(spoolFile), false);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('two processes cannot lose concurrent spool puts or stale acknowledgements', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-multiprocess-spool-'));
  try {
    await Promise.all([
      runSpoolWorker(stateDir, 'put', 'alpha-', 40),
      runSpoolWorker(stateDir, 'put', 'beta-', 40),
    ]);
    let records = JSON.parse(fs.readFileSync(path.join(stateDir, 'lifecycle-spool.json'), 'utf8'));
    assert.equal(records.length, 80);
    assert.equal(new Set(records.map((record) => record.key)).size, 80);

    await Promise.all([
      runSpoolWorker(stateDir, 'ack', 'alpha-', 40),
      runSpoolWorker(stateDir, 'put', 'gamma-', 40),
    ]);
    records = JSON.parse(fs.readFileSync(path.join(stateDir, 'lifecycle-spool.json'), 'utf8'));
    const keys = new Set(records.map((record) => record.key));
    assert.equal(records.length, 80);
    assert.equal([...keys].filter((key) => key.startsWith('alpha-')).length, 0);
    assert.equal([...keys].filter((key) => key.startsWith('beta-')).length, 40);
    assert.equal([...keys].filter((key) => key.startsWith('gamma-')).length, 40);

    const spool = new DurableLifecycleSpool(stateDir, 512);
    const principal = { version: 1, tenant_id: 'tenant', workspace_id: 'workspace', scope_credential_id: 'credential', agent_id: 'agent', user_id: 'user', channel_id: 'channel', session_id: 'session' };
    spool.put({ version: 3, key: 'shared-lifecycle', createdAt: new Date().toISOString(), principal, event: { result: 'shared', messages: [] }, context: { sessionKey: 'session', sessionId: 'session', channelId: 'channel', agentId: 'agent', userId: 'user', idempotencyKey: 'shared-lifecycle' }, fallbackText: 'shared' });
    const selectedReceipts = await Promise.all([
      runReceiptWorker(stateDir, 'server-receipt-alpha'),
      runReceiptWorker(stateDir, 'server-receipt-beta'),
    ]);
    assert.equal(new Set(selectedReceipts).size, 1, 'overlapping processes adopt one canonical server JTI');
    assert.equal(spool.entries().find((record) => record.key === 'shared-lifecycle').assuranceReceipt, selectedReceipts[0]);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('lifecycle replay quarantines every active-configuration principal mismatch', async () => {
  const variants = [
    { tenantId: 'tenant-other' },
    { workspaceId: 'workspace-other' },
    { scopeCredentialId: 'bridge-other' },
    { scopeHmacSecret: 'scope-other-secret' },
    { sessionIdentityHmacSecret: 'session-other-secret' },
  ];
  const originalFetch = globalThis.fetch;
  try {
    for (const variant of variants) {
      const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-scope-mismatch-'));
      let commitRequests = 0;
      globalThis.fetch = async (url) => {
        if (String(url).endsWith('/nexus/assurance/receipt')) return successfulCommitResponse();
        commitRequests += 1;
        return new Response(JSON.stringify({ success: false, committed: false, durable_write: { status: 'write_failed' } }));
      };
      try {
        const firstHandlers = new Map();
        const config = lifecycleConfig({ stateDir, enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0 });
        plugin.register({
          pluginConfig: config,
          logger: { info() {}, warn() {} },
          on(name, handler) { firstHandlers.set(name, handler); },
          registerMemoryRuntime() {},
          registerTool() {},
        });
        const context = {
          sessionKey: 'scope-mismatch-session',
          userId: 'scope-user',
          channelId: 'scope-channel',
          agentId: 'scope-agent',
        };
        firstHandlers.get('llm_output')({ content: 'output that must never cross a principal boundary' }, context);
        await assert.rejects(() => firstHandlers.get('agent_end')({}, context), /output retained for retry/);
        const [spoolFile] = lifecycleSpoolFiles(stateDir);
        assert.ok(spoolFile);

        const warnings = [];
        plugin.register({
          pluginConfig: { ...config, ...variant },
          logger: { info() {}, warn(message) { warnings.push(message); } },
          on() {},
          registerMemoryRuntime() {},
          registerTool() {},
        });
        await new Promise((resolve) => setTimeout(resolve, 25));

        assert.equal(commitRequests, 1, `mismatched ${Object.keys(variant)[0]} must not replay`);
        assert.equal(fs.existsSync(spoolFile), false);
        assert.ok(
          fs.readdirSync(path.dirname(spoolFile)).some((name) => name.includes('principal-scope-mismatch') && name.endsWith('.quarantine')),
          `mismatched ${Object.keys(variant)[0]} spool is quarantined`,
        );
        assert.ok(warnings.some((message) => message.includes('inactive principal scope')));
      } finally {
        fs.rmSync(stateDir, { recursive: true, force: true });
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('legacy unscoped lifecycle spool is quarantined without replay', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-legacy-spool-'));
  fs.writeFileSync(path.join(stateDir, 'lifecycle-spool.json'), JSON.stringify([{ version: 1, fallbackText: 'foreign output' }]));
  let fetched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched = true; return successfulCommitResponse(); };
  try {
    const warnings = [];
    plugin.register({
      pluginConfig: lifecycleConfig({ stateDir, enabledWriteThrough: true }),
      logger: { info() {}, warn(message) { warnings.push(message); } },
      on() {},
      registerMemoryRuntime() {},
      registerTool() {},
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fetched, false);
    assert.equal(fs.existsSync(path.join(stateDir, 'lifecycle-spool.json')), false);
    assert.ok(fs.readdirSync(stateDir).some((name) => name.includes('legacy-unscoped') && name.endsWith('.quarantine')));
    assert.ok(warnings.some((message) => message.includes('unscoped lifecycle spool')));
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('recent output, dedupe, and server receipts isolate colliding raw sessions by complete principal', async () => {
  const handlers = new Map();
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/nexus/assurance/receipt')) {
      return new Response(JSON.stringify({ success: true, receipt: `scope-receipt-${requests.length}` }));
    }
    requests.push(JSON.parse(String(options?.body || '{}')));
    return successfulCommitResponse();
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({ enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0 }),
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const alpha = { sessionKey: 'colliding-session', userId: 'user-alpha', channelId: 'same-channel', agentId: 'same-agent' };
    const beta = { sessionKey: 'colliding-session', userId: 'user-beta', channelId: 'same-channel', agentId: 'same-agent' };
    handlers.get('llm_output')({ content: 'alpha principal private lifecycle output' }, alpha);
    handlers.get('llm_output')({ content: 'beta principal private lifecycle output' }, beta);
    await handlers.get('agent_end')({}, alpha);
    await handlers.get('agent_end')({}, beta);

    assert.equal(requests.length, 2);
    assert.match(requests[0].response, /alpha principal/);
    assert.doesNotMatch(requests[0].response, /beta principal/);
    assert.match(requests[1].response, /beta principal/);
    assert.doesNotMatch(requests[1].response, /alpha principal/);
    assert.equal(requests[0].metadata.scope.user_id, 'user-alpha');
    assert.equal(requests[1].metadata.scope.user_id, 'user-beta');
    assert.notEqual(requests[0].assurance_receipt, requests[1].assurance_receipt);
    assert.equal('idempotency_key' in requests[0].metadata, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('principal namespaces preserve the global durable spool bound', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-global-spool-bound-'));
  const handlers = new Map();
  const requests = [];
  const warnings = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/nexus/assurance/receipt')) return successfulCommitResponse();
    requests.push(JSON.parse(String(options?.body || '{}')));
    return new Response(JSON.stringify({ success: false, committed: false, durable_write: { status: 'write_failed' } }));
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({
        stateDir,
        enabledWriteThrough: true,
        minDurabilityScore: 0,
        retryCount: 0,
        lifecycleSpoolMaxRecords: 2,
      }),
      logger: { info() {}, warn(message) { warnings.push(message); } },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    for (const userId of ['principal-one', 'principal-two', 'principal-three']) {
      const context = { sessionKey: 'shared-session', userId, channelId: 'shared-channel', agentId: 'shared-agent' };
      handlers.get('llm_output')({ content: `pending output for ${userId}` }, context);
      await assert.rejects(() => handlers.get('agent_end')({}, context), /output retained for retry/);
    }

    const retained = lifecycleSpoolFiles(stateDir)
      .flatMap((spoolFile) => JSON.parse(fs.readFileSync(spoolFile, 'utf8')));
    assert.equal(retained.length, 2);
    assert.equal(requests.length, 2, 'the third principal cannot multiply the configured spool capacity');
    assert.ok(warnings.some((message) => message.includes('exhausted across principals at 2 records')));
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('separate workers serialize global admission across distinct principal namespaces', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-worker-global-quota-'));
  const startPath = path.join(stateDir, 'start');
  const moduleUrl = new URL('./index.ts', import.meta.url).href;
  const workers = ['worker-user-a', 'worker-user-b'].map((userId, index) => {
    const readyPath = path.join(stateDir, `ready-${index}`);
    const script = `
      import fs from 'node:fs';
      import plugin from ${JSON.stringify(moduleUrl)};
      const handlers = new Map();
      globalThis.fetch = async (url) => String(url).endsWith('/nexus/assurance/receipt')
        ? new Response(JSON.stringify({ success: true, receipt: 'worker-receipt' }))
        : new Response(JSON.stringify({ success: false, committed: false, durable_write: { status: 'write_failed' } }));
      plugin.register({
        pluginConfig: {
          stateDir: ${JSON.stringify(stateDir)}, tenantId: 'tenant-test', workspaceId: 'workspace-test',
          scopeCredentialId: 'bridge-test', scopeHmacSecret: 'scope-test-secret',
          sessionIdentityHmacSecret: 'session-test-secret', writeToken: 'worker-write-token',
          enabledWriteThrough: true, enabledCodecContinuity: false, minDurabilityScore: 0,
          retryCount: 0, lifecycleSpoolMaxRecords: 1,
        },
        logger: { info() {}, warn() {} },
        on(name, handler) { handlers.set(name, handler); }, registerMemoryRuntime() {}, registerTool() {},
      });
      fs.writeFileSync(${JSON.stringify(readyPath)}, 'ready');
      while (!fs.existsSync(${JSON.stringify(startPath)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      const context = { sessionKey: 'shared-session', userId: ${JSON.stringify(userId)}, channelId: 'shared-channel', agentId: 'shared-agent' };
      handlers.get('llm_output')({ content: 'pending output for ' + ${JSON.stringify(userId)} }, context);
      try { await handlers.get('agent_end')({}, context); } catch {}
    `;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    const completion = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`quota worker exited ${code}: ${stderr}`)));
    });
    return { readyPath, completion };
  });
  try {
    const deadline = Date.now() + 5_000;
    while (!workers.every(({ readyPath }) => fs.existsSync(readyPath))) {
      if (Date.now() >= deadline) throw new Error('quota workers did not reach the admission barrier');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    fs.writeFileSync(startPath, 'start');
    await Promise.all(workers.map(({ completion }) => completion));
    const retained = lifecycleSpoolFiles(stateDir)
      .flatMap((spoolFile) => JSON.parse(fs.readFileSync(spoolFile, 'utf8')));
    assert.equal(retained.length, 1);
    assert.equal(new Set(retained.map((record) => record.principal.user_id)).size, 1);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('explicitly disabling every persistence mode fails acknowledgement and retains output', async () => {
  const handlers = new Map();
  plugin.register({
    pluginConfig: lifecycleConfig({ enabledWriteThrough: false, enabledCodecContinuity: false }),
    logger: { info() {}, warn() {} },
    on(name, handler) { handlers.set(name, handler); },
    registerMemoryRuntime() {},
    registerTool() {},
  });
  const context = lifecycleContext('disabled-session');
  handlers.get('llm_output')({ content: 'output cannot be called persisted while every writer is disabled' }, context);
  await assert.rejects(
    () => handlers.get('agent_end')({}, context),
    /output retained for retry/,
  );
});

test('lifecycle keys hash exact length-delimited session and payload bytes', () => {
  const sharedSuffix = 'x'.repeat(5_000);
  const first = lifecyclePersistenceKey('session', `first:${sharedSuffix}`);
  const second = lifecyclePersistenceKey('session', `second:${sharedSuffix}`);

  assert.notEqual(first, second, 'payloads differing outside the old truncated suffix remain distinct');
  assert.equal(first, lifecyclePersistenceKey('session', `first:${sharedSuffix}`), 'identical retries are stable');
  assert.notEqual(
    lifecyclePersistenceKey('ab', 'c'),
    lifecyclePersistenceKey('a', 'bc'),
    'length delimiters make session/payload boundaries unambiguous',
  );
  assert.match(first, /^session:[0-9a-f]{64}$/);
});

test('recent output cache is deterministic LRU with bounded capacity and TTL expiry', () => {
  const cache = new ExpiringLruMap(2, 100);
  cache.set('abandoned-a', 'a', 1_000);
  cache.set('abandoned-b', 'b', 1_010);
  assert.equal(cache.get('abandoned-a', 1_020), 'a');

  cache.set('abandoned-c', 'c', 1_030);
  assert.equal(cache.size, 2);
  assert.equal(cache.get('abandoned-b', 1_030), undefined, 'least-recently-used session is evicted');
  assert.equal(cache.get('abandoned-a', 1_099), 'a');
  assert.equal(cache.get('abandoned-a', 1_100), undefined, 'TTL is based on insertion, not reads');
  assert.equal(cache.get('abandoned-c', 1_130), undefined);
  assert.equal(cache.size, 0);
});

test('agent_end eagerly deletes recent output lifecycle state', async () => {
  const handlers = new Map();
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/nexus/assurance/receipt')) return successfulCommitResponse();
    requests.push(JSON.parse(String(options?.body || '{}')));
    return successfulCommitResponse();
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({ enabledWriteThrough: true, minDurabilityScore: 0 }),
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const context = lifecycleContext('session-ended');
    handlers.get('llm_output')({ content: 'durable first lifecycle output' }, context);
    await handlers.get('agent_end')({}, context);
    await handlers.get('subagent_ended')({}, context);

    assert.equal(requests.length, 1);
    assert.match(requests[0].response, /durable first lifecycle output/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('failed subagent persistence is retried by agent_end with the same server receipt', async () => {
  const handlers = new Map();
  const requests = [];
  const originalFetch = globalThis.fetch;
  let receiptRequests = 0;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body || '{}'));
    if (String(url).endsWith('/nexus/assurance/receipt')) {
      receiptRequests += 1;
      return successfulCommitResponse();
    }
    requests.push(body);
    if (requests.length === 1) throw new Error('transient write failure');
    return successfulCommitResponse();
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({ enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0 }),
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const context = lifecycleContext('retry-session');
    handlers.get('llm_output')({ content: 'durable lifecycle output that must survive a transient failure' }, context);
    await handlers.get('subagent_ended')({}, context);
    await handlers.get('agent_end')({}, context);

    assert.equal(requests.length, 2);
    assert.equal(receiptRequests, 1);
    assert.equal(requests[0].assurance_receipt, requests[1].assurance_receipt);
    assert.equal('idempotency_key' in requests[0].metadata, false);
    assert.match(requests[1].response, /durable lifecycle output/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('lifecycle writes distinguish bounded outputs that share a long suffix', async () => {
  const handlers = new Map();
  const requests = [];
  const originalFetch = globalThis.fetch;
  let receiptNumber = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/nexus/assurance/receipt')) {
      receiptNumber += 1;
      return new Response(JSON.stringify({ success: true, receipt: `bounded-receipt-${receiptNumber}` }));
    }
    requests.push(JSON.parse(String(options?.body || '{}')));
    return successfulCommitResponse();
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({ enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0 }),
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const sharedSuffix = 'x'.repeat(3_000);
    const context = lifecycleContext('same-session');
    handlers.get('llm_output')({ content: `first:${sharedSuffix}` }, context);
    await handlers.get('agent_end')({}, context);
    handlers.get('llm_output')({ content: `second:${sharedSuffix}` }, context);
    await handlers.get('agent_end')({}, context);

    assert.equal(requests.length, 2);
    assert.notEqual(requests[0].assurance_receipt, requests[1].assurance_receipt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('concurrent lifecycle hooks coalesce into one persistence write', async () => {
  const handlers = new Map();
  const requests = [];
  const originalFetch = globalThis.fetch;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/nexus/assurance/receipt')) return successfulCommitResponse();
    requests.push(JSON.parse(String(options?.body || '{}')));
    await blocked;
    return successfulCommitResponse();
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({ enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0 }),
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const context = lifecycleContext('concurrent-session');
    handlers.get('llm_output')({ content: 'one durable output shared by concurrent lifecycle hooks' }, context);
    const first = handlers.get('subagent_ended')({}, context);
    const second = handlers.get('agent_end')({}, context);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 1);
    release();
    await Promise.all([first, second]);
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('distinct lifecycle runs persist identical output in the same session', async () => {
  const handlers = new Map();
  const requests = [];
  const originalFetch = globalThis.fetch;
  let receiptNumber = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/nexus/assurance/receipt')) {
      receiptNumber += 1;
      return new Response(JSON.stringify({ success: true, receipt: `run-receipt-${receiptNumber}` }));
    }
    requests.push(JSON.parse(String(options?.body || '{}')));
    return successfulCommitResponse();
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({ enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0 }),
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const output = handlers.get('llm_output');
    const end = handlers.get('agent_end');
    output({ content: 'the same legitimate durable completion' }, lifecycleContext('repeat-session'));
    await end({}, lifecycleContext('repeat-session', { runId: 'run-one' }));
    output({ content: 'the same legitimate durable completion' }, lifecycleContext('repeat-session'));
    await end({}, lifecycleContext('repeat-session', { runId: 'run-two' }));

    assert.equal(requests.length, 2);
    assert.notEqual(requests[0].assurance_receipt, requests[1].assurance_receipt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('concurrent hooks with the same lifecycle run coalesce despite differing output', async () => {
  const handlers = new Map();
  const requests = [];
  const originalFetch = globalThis.fetch;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/nexus/assurance/receipt')) return successfulCommitResponse();
    requests.push(JSON.parse(String(options?.body || '{}')));
    await blocked;
    return successfulCommitResponse();
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({ enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0 }),
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const first = handlers.get('subagent_ended')(
      { result: 'durable completion from the subagent hook', runId: 'shared-run' },
      lifecycleContext('shared-run-session'),
    );
    const second = handlers.get('agent_end')(
      { result: 'durable completion with slightly different agent hook text' },
      lifecycleContext('shared-run-session', { run_id: 'shared-run' }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 1);
    release();
    await Promise.all([first, second]);
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('recent outputs are truncated before caching, keying, and concurrent persistence', async () => {
  const handlers = new Map();
  const requests = [];
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-memory-bridge-bounded-key-'));
  const originalFetch = globalThis.fetch;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/nexus/assurance/receipt')) return successfulCommitResponse();
    requests.push(JSON.parse(String(options?.body || '{}')));
    await blocked;
    return successfulCommitResponse();
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({ stateDir, enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0, recentOutputMaxChars: 64 }),
      logger: { info() {}, warn() {} },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const retainedTail = 'TAIL-' + '🛡️'.repeat(20);
    assert.equal(retainedTail.length, 65);
    const expected = retainedTail.slice(-64);
    const context = lifecycleContext('bounded-session');
    handlers.get('llm_output')({ content: `${'attacker-prefix-'.repeat(100_000)}${retainedTail}` }, context);

    const first = handlers.get('subagent_ended')({}, context);
    const second = handlers.get('agent_end')({}, context);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 1, 'concurrent hooks coalesce on the truncated payload key');
    const [spoolFile] = lifecycleSpoolFiles(stateDir);
    const [spoolRecord] = JSON.parse(fs.readFileSync(spoolFile, 'utf8'));
    assert.match(spoolRecord.key, /^[0-9a-f]{64}:[0-9a-f]{64}$/);
    assert.equal(requests[0].assurance_receipt, spoolRecord.assuranceReceipt);
    assert.match(requests[0].response, new RegExp(expected.slice(-20)));
    assert.doesNotMatch(requests[0].response, /attacker-prefix/);
    release();
    await Promise.all([first, second]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('lifecycle persistence applies bounded backpressure and drains queued output without loss', async () => {
  const handlers = new Map();
  const requests = [];
  const warnings = [];
  const releases = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/nexus/assurance/receipt')) return successfulCommitResponse();
    requests.push(JSON.parse(String(options?.body || '{}')));
    await new Promise((resolve) => { releases.push(resolve); });
    return successfulCommitResponse();
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({ enabledWriteThrough: true, minDurabilityScore: 0, retryCount: 0, lifecycleMaxInFlight: 2 }),
      logger: { info() {}, warn(message) { warnings.push(message); } },
      on(name, handler) { handlers.set(name, handler); },
      registerMemoryRuntime() {},
      registerTool() {},
    });
    const output = handlers.get('llm_output');
    const end = handlers.get('agent_end');
    const firstContext = lifecycleContext('one');
    const secondContext = lifecycleContext('two');
    const thirdContext = lifecycleContext('three');
    output({ content: 'slow payload one' }, firstContext);
    output({ content: 'slow payload two' }, secondContext);
    output({ content: 'overflow payload must not be retained' }, thirdContext);
    const first = end({}, firstContext);
    const coalesced = end({ result: 'slow payload one' }, firstContext);
    const second = end({}, secondContext);
    const backpressured = end({}, thirdContext);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 2, 'exactly the configured unique-work cap starts');
    assert.equal(warnings.length, 1);
    releases.shift()();
    await Promise.all([first, coalesced]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 3, 'cleanup drains one queued lifecycle write');
    assert.match(requests[2].response, /overflow payload must not be retained/);
    releases.splice(0).forEach((release) => release());
    await Promise.all([second, backpressured]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('parallel declared-size rejections do not await stalled body cancellation', async () => {
  let searchTool;
  const cancellations = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const cancellation = { called: false };
    cancellations.push(cancellation);
    return {
      ok: true,
      headers: new Headers({ 'content-length': '65' }),
      body: {
        async cancel() {
          cancellation.called = true;
          await new Promise(() => {});
        },
      },
    };
  };
  try {
    plugin.register({
      pluginConfig: lifecycleConfig({ maxResponseBytes: 64, retryCount: 0 }),
      logger: { info() {}, warn() {} },
      on() {},
      registerMemoryRuntime() {},
      registerTool(factory, options) {
        if (options?.names?.includes('memory_search')) searchTool = factory({
          sessionKey: 'oversized-session',
          requesterSenderId: 'oversized-user',
          messageChannel: 'test-channel',
          agentId: 'main',
        });
      },
    });

    const results = await Promise.all([
      searchTool.execute('oversized-1', { query: 'first request' }),
      searchTool.execute('oversized-2', { query: 'second request' }),
    ]);

    assert.equal(cancellations.length, 2);
    assert.ok(cancellations.every(({ called }) => called), 'each rejected response body is canceled');
    for (const result of results) {
      assert.match(JSON.parse(result).error, /response exceeds 64 bytes/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('canonical project-status summaries score as durable project state', () => {
  const text = `Mailchimp remediated-run takeaway: trustworthy partial result. Current canonical status: supervisorStatus: red, matrixStatus: partial, parityStatus: partial, blocker: null. Remaining surfaces: C_data_model_and_persistence_parity, E_reporting_analytics_parity. Persistence first. Reply-anchor context should be treated as primary.`;
  const dur = durabilityScore(text);

  assert.equal(dur.kind, 'project_state');
  assert.ok(dur.score >= 0.78, `expected score >= 0.78, got ${dur.score}`);
  assert.match(dur.reasons.join(','), /canonical_project_status/);
  assert.match(dur.reasons.join(','), /named_project/);
});

test('write-through metadata labels model output as an unvalidated assurance candidate', () => {
  const cfg = {
    writeTags: ['durable-memory', 'assurance-candidate', 'cortex-upgrade'],
  };
  const ctx = { channelId: 'whatsapp', sessionKey: 'sess-mailchimp' };
  const text = `Mailchimp current canonical status: supervisorStatus: red, matrixStatus: partial, parityStatus: partial. Remaining surfaces: C_data_model_and_persistence_parity.`;
  const dur = durabilityScore(text);
  const metadata = buildWriteThroughMetadata(cfg, ctx, text, dur);

  assert.equal(metadata.source, 'openclaw-project-state-candidate');
  assert.equal(metadata.quality, 'candidate');
  assert.equal(metadata.assurance_status, 'unvalidated');
  assert.equal(metadata.project, 'mailchimp');
  assert.equal(metadata.topic, 'mailchimp-canonical-status');
  assert.ok(metadata.tags.includes('mailchimp'));
  assert.ok(metadata.tags.includes('canonical_project_status'));
});

test('ephemeral chat stays below durability threshold', () => {
  const text = 'ok thanks lol';
  const dur = durabilityScore(text);
  assert.equal(dur.kind, 'transient');
  assert.ok(dur.score < 0.78);
});

test('preference recall ranks explicit reply-prefix memory above codec open loops', () => {
  const cfg = {
    curatedBoost: 0.24,
    projectFactBoost: 0.12,
    durableCandidatePenalty: 0.14,
    noisyWhatsappPenalty: 0.26,
    noisyPatternPenalty: 0.2,
    conflictPenalty: 0.18,
    recencyBoost: 0.12,
    explicitBoost: 0.14,
    corroborationBoost: 0.08,
    hardQueryCandidateCount: 12,
  };
  const results = reconcileResults(
    'What should replies begin with for Jake?',
    [
      {
        id: 'loop-1',
        text: 'Open loops: What did Jake ask me to prefix replies with? What did Jake ask me to prefix replies with?',
        distance: 0.05,
        metadata: {
          type: 'codec_state',
          tags: ['cortex_codec', 'codec_state', 'durable_memory'],
          source: 'chroma_docs',
        },
      },
      {
        id: 'pref-1',
        text: 'Jake prefers replies to begin with [Cortex].',
        distance: 0.08,
        metadata: {
          type: 'codec_state',
          tags: ['cortex_codec', 'codec_state', 'durable_memory'],
        },
      },
    ],
    cfg,
  );

  assert.equal(results.results[0].citation, 'cortex:pref-1');
  assert.match(results.results[0].snippet, /\[Cortex\]/);
});

test('preference recall demotes question-echo codec summaries below explicit fact rows', () => {
  const cfg = {
    curatedBoost: 0.24,
    projectFactBoost: 0.12,
    durableCandidatePenalty: 0.14,
    noisyWhatsappPenalty: 0.26,
    noisyPatternPenalty: 0.2,
    conflictPenalty: 0.18,
    recencyBoost: 0.12,
    explicitBoost: 0.14,
    corroborationBoost: 0.08,
    hardQueryCandidateCount: 12,
  };
  const results = reconcileResults(
    'What should replies begin with for Jake?',
    [
      {
        id: 'loop-1',
        text: 'Open loops: What did Jake ask me to prefix replies with? What did Jake ask me to prefix replies with?',
        distance: 0.05,
        metadata: { type: 'codec_state', tags: ['cortex_codec', 'codec_state', 'durable_memory'], source: 'chroma_docs' },
      },
      {
        id: 'loop-2',
        text: 'Projects: regression-safe | Goals: Implement a regression-safe fix and validate it with tests. | Open loops: What did Jake ask me to prefix replies with?',
        distance: 0.05,
        metadata: { type: 'codec_state', tags: ['cortex_codec', 'codec_state', 'durable_memory'], source: 'chroma_docs' },
      },
      {
        id: 'pref-1',
        text: 'Jake prefers replies to begin with [Cortex]. Projects: Cortex Codec, Jake, Nexus | Goals: Build the Cortex Codec into Nexus and OpenClaw.',
        distance: 0.08,
        metadata: { type: 'codec_state', tags: ['cortex_codec', 'codec_state', 'durable_memory'] },
      },
    ],
    cfg,
  );

  assert.equal(results.results[0].citation, 'cortex:pref-1');
  assert.ok(results.results[0].score > results.results[1].score);
});

test('reconciliation broadly ranks fresh corrected facts above stale negative rows', () => {
  const cfg = {
    curatedBoost: 0.24,
    projectFactBoost: 0.12,
    durableCandidatePenalty: 0.14,
    noisyWhatsappPenalty: 0.26,
    noisyPatternPenalty: 0.2,
    conflictPenalty: 0.18,
    recencyBoost: 0.12,
    explicitBoost: 0.14,
    corroborationBoost: 0.08,
    hardQueryCandidateCount: 12,
  };
  const results = reconcileResults(
    'Nexus webhook bridge implemented verified',
    [
      {
        id: 'old-negative',
        text: 'Could not find any evidence that the Nexus webhook bridge was implemented or verified.',
        distance: 0.01,
        score: 0.84,
        metadata: { source: 'local_file_memory', quality: 'curated', stale_negative_memory: true },
      },
      {
        id: 'fresh-current',
        text: 'Current canonical status: Nexus webhook bridge implemented, synced, and live verification tests passed.',
        distance: 0.9,
        score: 1,
        metadata: { source: 'local_file_memory', quality: 'curated', correction_memory: true },
      },
    ],
    cfg,
  );

  assert.equal(results.results[0].citation, 'cortex:fresh-current');
  assert.ok(!results.results.some((row) => row.citation === 'cortex:old-negative'));
});

test('negative-evidence queries preserve missing/not-found rows', () => {
  const cfg = {
    curatedBoost: 0.24,
    projectFactBoost: 0.12,
    durableCandidatePenalty: 0.14,
    noisyWhatsappPenalty: 0.26,
    noisyPatternPenalty: 0.2,
    conflictPenalty: 0.18,
    recencyBoost: 0.12,
    explicitBoost: 0.14,
    corroborationBoost: 0.08,
    hardQueryCandidateCount: 12,
  };
  const results = reconcileResults(
    'what was missing for Nexus webhook bridge',
    [
      {
        id: 'old-negative',
        text: 'Could not find any evidence that the Nexus webhook bridge was implemented or verified.',
        distance: 0.01,
        score: 0.84,
        metadata: { source: 'local_file_memory', quality: 'curated', stale_negative_memory: true },
      },
      {
        id: 'fresh-current',
        text: 'Current canonical status: Nexus webhook bridge implemented, synced, and live verification tests passed.',
        distance: 0.9,
        score: 1,
        metadata: { source: 'local_file_memory', quality: 'curated', correction_memory: true },
      },
    ],
    cfg,
  );

  assert.ok(results.results.some((row) => row.citation === 'cortex:old-negative'));
});

test('implemented orchestration facts beat older implement-next-action rows', () => {
  const cfg = {
    curatedBoost: 0.24,
    projectFactBoost: 0.12,
    durableCandidatePenalty: 0.14,
    noisyWhatsappPenalty: 0.26,
    noisyPatternPenalty: 0.2,
    conflictPenalty: 0.18,
    recencyBoost: 0.12,
    explicitBoost: 0.14,
    corroborationBoost: 0.08,
    hardQueryCandidateCount: 12,
  };
  const results = reconcileResults(
    'agent orchestration objective expansion generic repair loop',
    [
      {
        id: 'older-plan',
        text: 'Next action: implement the generic objective expansion repair loop in agent orchestration.',
        distance: 0.02,
        score: 0.92,
        metadata: { source: 'local_file_memory', quality: 'curated' },
      },
      {
        id: 'implemented-fact',
        text: 'Generic objective-truth repair loop implemented and synced to Hetzner in the shared agent-orchestration layer.',
        distance: 0.8,
        score: 1,
        metadata: { source: 'local_file_memory', quality: 'curated', correction_memory: true },
      },
    ],
    cfg,
  );

  assert.equal(results.results[0].citation, 'cortex:implemented-fact');
  assert.ok(!results.results.some((row) => row.citation === 'cortex:older-plan'));
});

test('memory-system repair notes do not outrank domain facts for domain queries', () => {
  const cfg = {
    curatedBoost: 0.24,
    projectFactBoost: 0.12,
    durableCandidatePenalty: 0.14,
    noisyWhatsappPenalty: 0.26,
    noisyPatternPenalty: 0.2,
    conflictPenalty: 0.18,
    recencyBoost: 0.12,
    explicitBoost: 0.14,
    corroborationBoost: 0.08,
    hardQueryCandidateCount: 12,
  };
  const results = reconcileResults(
    'Morgan correspondence SimplePractice NPI billing provider',
    [
      {
        id: 'meta-fix',
        text: 'Live verification: memory_search("Morgan correspondence SimplePractice NPI billing provider") now returns pmhnp-billing correction rows first. Regression coverage added in test_librarian_recall_fallback.py.',
        score: 1,
        metadata: { source: 'local_file_memory' },
      },
      {
        id: 'domain-fact',
        text: 'BCBS SimplePractice enrollment/NPI truth corrected: use Harbor Behavioral Health PLLC organization NPI 2 and PLLC EIN as billing provider, with Morgan individual NPI 1 as rendering provider.',
        score: 0.95,
        metadata: { source: 'local_file_memory', quality: 'curated', correction_memory: true },
      },
    ],
    cfg,
  );

  assert.equal(results.results[0].citation, 'cortex:domain-fact');
  assert.ok(!results.results.some((row) => row.citation === 'cortex:meta-fix'));
});

test('explicit supersession is hidden for current queries and retained for historical queries', () => {
  const cfg = {
    curatedBoost: 0.24, projectFactBoost: 0.12, durableCandidatePenalty: 0.14,
    noisyWhatsappPenalty: 0.26, noisyPatternPenalty: 0.2, conflictPenalty: 0.18,
    recencyBoost: 0.12, explicitBoost: 0.14, corroborationBoost: 0.08, hardQueryCandidateCount: 12,
  };
  const rows = [
    { id: 'old', text: 'Agent Work needs its first product dogfood.', score: 1, metadata: { memory_status: 'superseded' } },
    { id: 'new', text: 'Agent Work product dogfood is already proven.', score: 0.8, metadata: { memory_status: 'active', authority_rank: 90, correction_memory: true } },
  ];
  const current = reconcileResults('What is the current Agent Work dogfood status?', rows, cfg);
  assert.deepEqual(current.results.map((row) => row.citation), ['cortex:new']);
  const history = reconcileResults('Show historical superseded Agent Work dogfood memory', rows, cfg);
  assert.ok(history.results.some((row) => row.citation === 'cortex:old'));
});
