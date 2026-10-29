'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJiti } = require('/opt/openclaw-preastra-restore/2026.7.1-2/runtime/openclaw/node_modules/jiti/lib/jiti.cjs');

const root = path.resolve(__dirname, '..');
const jiti = createJiti(__filename, { interopDefault: true, moduleCache: false });
const routeModule = jiti(path.join(root, 'plugins/cortex-route-gate/index.ts'));
const memoryModule = jiti(path.join(root, 'plugins/cortex-memory-bridge/index.ts'));
const routePlugin = routeModule.default || routeModule;
const routeManifest = JSON.parse(fs.readFileSync(path.join(root, 'plugins/cortex-route-gate/openclaw.plugin.json'), 'utf8'));
assert.deepEqual(routeManifest.contracts?.tools, ['cortex_daily_work']);

function fakeApi() {
  const hooks = new Map();
  const tools = [];
  return {
    pluginConfig: {
      enabled: true,
      requireRouting: false,
      baseUrl: 'http://127.0.0.1:8888',
      allowUnsignedLocalDevelopment: false,
      tenantId: 'tenant-smoke',
      workspaceId: 'workspace-smoke',
      scopeCredentialId: 'smoke-credential',
      scopeHmacSecret: 'h'.repeat(64),
      writeToken: 'w'.repeat(64),
      routeCacheHmacSecret: 'r'.repeat(64),
      sessionIdentityHmacSecret: 's'.repeat(64),
      stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-daily-work-route-')),
      oracleConsultEnabled: false,
      oracleSemanticRoutingEnabled: false,
      creativityGovernorEnabled: false,
      creativityAuditEnabled: false,
      privateRetrievalShadowTelemetryEnabled: false,
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    on(name, handler) { hooks.set(name, handler); },
    registerTool(factory, options) { tools.push({ factory, options }); },
    sendUserMessage: async () => {},
    __hooks: hooks,
    __tools: tools,
  };
}

const api = fakeApi();
if (typeof routePlugin === 'function') routePlugin(api);
else routePlugin.register(api);
const requiredHooks = ['before_prompt_build', 'after_tool_call', 'before_agent_finalize', 'message_sending'];
for (const hook of requiredHooks) assert.equal(api.__hooks.has(hook), true, `missing default hook ${hook}`);
assert.equal(api.__tools.some((row) => row.options?.names?.includes('cortex_daily_work')), true, 'daily work tool not registered on default route plugin');

const modes = {
  rewrite: routeModule.classifyWorkMode('Can you reword this contract message for me?'),
  advise: routeModule.classifyWorkMode('Should I charge extra for this analysis?'),
  execute: routeModule.classifyWorkMode('Implement all five improvements and deploy them.'),
  investigate: routeModule.classifyWorkMode('Diagnose why the state disappeared.'),
};
assert.deepEqual(modes, { rewrite: 'rewrite', advise: 'advise', execute: 'execute', investigate: 'investigate' });
assert.equal(routeModule.isConsequentialRequest('Can you reword this billing message?', 'rewrite'), false);
assert.equal(routeModule.isConsequentialRequest('Should I interpret this payer contract?', 'advise'), true);
assert.equal(routeModule.exactCurrentUserQuotePresent('Please track that I will send the report.', 'I will send the report.'), true);
assert.equal(routeModule.exactCurrentUserQuotePresent('Please track that I will send the report.', 'I promised to send it tomorrow.'), false);

const rewritePlan = routeModule.applyWorkModeRouting({
  recommendedLevels: [
    { level: 34, name: 'validator', alwaysOn: true, origin: 'local_mandatory' },
    { level: 9, name: 'architect', origin: 'provider' },
  ],
  routingMethod: 'smoke', reasoning: [],
}, 'rewrite', false, 'reword this');
assert.deepEqual(rewritePlan.recommendedLevels.map((row) => row.level), [34]);
const advisePlan = routeModule.applyWorkModeRouting({
  recommendedLevels: [{ level: 34, name: 'validator', alwaysOn: true, origin: 'local_mandatory' }],
  routingMethod: 'smoke', reasoning: [],
}, 'advise', true, 'interpret this current payer contract');
assert.equal(advisePlan.recommendedLevels.some((row) => row.level === 3), true);
assert.equal(advisePlan.recommendedLevels.some((row) => row.level === 2), true);

const evidenceOutcomes = {
  aborted: routeModule.classifyToolEvidence({ ok: false, error: 'aborted by caller' }).outcome,
  failed: routeModule.classifyToolEvidence({ success: false, error: 'HTTP 500' }).outcome,
  empty: routeModule.classifyToolEvidence('').outcome,
  usable: routeModule.classifyToolEvidence({ ok: true, content: 'signed source text' }).outcome,
};
assert.deepEqual(evidenceOutcomes, { aborted: 'aborted', failed: 'failed', empty: 'empty', usable: 'usable' });

const rejectedGuard = {
  stateKey: 'smoke', workMode: 'advise', consequential: true,
  latestUserText: 'The user said the fee has not been agreed.', createdAt: Date.now(),
  evidence: [
    { toolName: 'read', ok: false, outcome: 'aborted', payloadChars: 0 },
    { toolName: 'memory_search', ok: false, outcome: 'empty', payloadChars: 0 },
  ],
};
const qualified = routeModule.qualifyUnsupportedEvidenceClaims('I reviewed the agreement. The agreement says the fee is included.', rejectedGuard);
assert.match(qualified, /^Evidence status:/);
assert.equal(/\bI reviewed\b/i.test(qualified), false);
assert.match(qualified, /user-provided information, inference, or recommendation/);
const unrelatedUsableGuard = {
  ...rejectedGuard,
  evidence: [{ toolName: 'memory_search', ok: true, outcome: 'usable', sourceRef: 'memory_search:query_sha256:abc', payloadChars: 500 }],
};
const unrelatedQualified = routeModule.qualifyUnsupportedEvidenceClaims('I reviewed the agreement.', unrelatedUsableGuard);
assert.match(unrelatedQualified, /none was bound to the source being claimed/);
const acceptedGuard = {
  ...rejectedGuard,
  evidence: [{ toolName: 'read', ok: true, outcome: 'usable', sourceRef: 'read:/agreement.pdf', payloadChars: 500 }],
};
const accepted = routeModule.qualifyUnsupportedEvidenceClaims('I reviewed the agreement.', acceptedGuard);
assert.equal(accepted, 'I reviewed the agreement.');

const workContract = routeModule.renderDailyWorkContract('advise', true, true);
for (const label of ['user_fact', 'verified_source_fact', 'inference', 'recommendation']) assert.match(workContract, new RegExp(label));
assert.match(workContract, /failed, aborted, disabled, rejected, and empty/);
assert.match(workContract, /do not invent numeric scores/i);
const rewriteAdditions = routeModule.rewriteIntroducedFactAnchors('There will be a one-time fee.', 'There will be a one-time fee of $250.');
assert.deepEqual(rewriteAdditions, ['$250']);
const rewriteBlocked = routeModule.qualifyUnsupportedEvidenceClaims('There will be a one-time fee of $250.', {
  ...rejectedGuard, workMode: 'rewrite', consequential: false, latestUserText: 'There will be a one-time fee.', evidence: [],
});
assert.match(rewriteBlocked, /did not deliver that rewrite/);

function correction(prior, current) {
  const messages = [
    { role: 'user', content: prior },
    { role: 'assistant', content: 'Previous answer.' },
    { role: 'user', content: current },
  ];
  return memoryModule.scopeCorrectionCandidate(current, messages);
}
const sameA = correction('Advise me how much work a wording change deserves.', "That's overcomplicated; keep a wording change simple.");
const sameB = correction('Advise me how much work a wording change deserves.', 'No, keep that concise instead.');
const unrelated = correction('Diagnose why the production service failed.', 'No, investigate the logs before suggesting a cause.');
assert.ok(sameA && sameB && unrelated, 'strong corrections were not detected');
const sameIdentityA = memoryModule.scopeCorrectionIdentity(sameA, 'source-owner');
const sameIdentityB = memoryModule.scopeCorrectionIdentity(sameB, 'source-owner');
const unrelatedIdentity = memoryModule.scopeCorrectionIdentity(unrelated, 'source-owner');
assert.deepEqual(sameIdentityA, sameIdentityB, 'same-scope corrections must share claim/fact identity');
assert.notEqual(sameIdentityA.claimKey, unrelatedIdentity.claimKey, 'unrelated correction scope must remain distinct');
assert.match(sameA.text, /preserve unrelated facts/);
assert.match(sameA.text, /not independently verified/);

const result = {
  defaultIntegration: {
    hooks: requiredHooks,
    tool: 'cortex_daily_work',
  },
  proportionalRouting: { modes, rewriteLevels: rewritePlan.recommendedLevels.map((row) => row.level), consequentialAdviseLevels: advisePlan.recommendedLevels.map((row) => row.level) },
  evidenceBinding: { outcomes: evidenceOutcomes, rejectedClaimQualified: true, usableClaimPreserved: true, claimClasses: ['user_fact', 'verified_source_fact', 'inference', 'recommendation'] },
  rewrite: { addedFactAnchorsRejected: rewriteAdditions },
  corrections: { sameScopeIdentity: sameIdentityA, unrelatedScopeIdentity: unrelatedIdentity, preservesUnrelatedScope: true },
  safety: { externalSendInvoked: false, policyBypassInvoked: false },
};
process.stdout.write(JSON.stringify(result));
