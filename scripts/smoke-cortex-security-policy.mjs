#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function focused(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env: process.env });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  }
}

const apiUnit = read('ops/systemd/cortex.service');
assert.match(apiUnit, /^User=cortex$/m);
assert.match(apiUnit, /^CapabilityBoundingSet=$/m);
assert.doesNotMatch(apiUnit, /^ReadWritePaths=.*(?:\.openclaw|\/opt\/clawdbot)/m);
assert.match(apiUnit, /^ReadOnlyPaths=.*\/opt\/clawdbot$/m);
assert.match(apiUnit, /^InaccessiblePaths=.*\/root\/\.openclaw$/m);
assert.match(apiUnit, /^Environment=ORACLE_OPENCLAW_DIRECT_ENABLED=false$/m);

const helperUnit = read('ops/systemd/cortex-oracle-executor.service');
assert.match(helperUnit, /--host 127\.0\.0\.1 --port 18999/);
assert.match(helperUnit, /^CapabilityBoundingSet=$/m);
assert.match(helperUnit, /^ProtectHome=tmpfs$/m);
assert.match(helperUnit, /^Environment=OPENCLAW_STATE_DIR=\/var\/lib\/cortex-oracle\/openclaw-state$/m);
assert.match(helperUnit, /^Environment=ORACLE_EXECUTOR_SESSION_DIR=\/var\/lib\/cortex-oracle\/openclaw-state\/agents\/oracle\/sessions$/m);
assert.match(helperUnit, /^BindPaths=\/opt\/openclaw-preastra-restore\/2026\.7\.1-2\/state\/agents\/main\/agent:\/var\/lib\/cortex-oracle\/openclaw-state\/agents\/main\/agent$/m);
assert.match(helperUnit, /^InaccessiblePaths=.*\/opt\/openclaw-preastra-restore\/2026\.7\.1-2\/state$/m);
assert.doesNotMatch(helperUnit, /^ReadWritePaths=.*\/root\/\.openclaw(?:\s|$)/m);

const environmentContract = JSON.parse(read('ops/config/cortex-env.schema.json'));
assert.equal(environmentContract.properties.CORTEX_DB_PATH.const, '/var/lib/cortex/knowledge/cortex_graph.db');
assert.equal(environmentContract.properties.CORTEX_L22_STRUCTURED_DB.const, '/var/lib/cortex/state/l22-structured.db');
const runtimeSurfaces = JSON.parse(read('ops/release/runtime-surfaces.json'));
assert.equal(runtimeSurfaces.mutableRoots.some((entry) => entry.path === '/opt/clawdbot'), false);
assert.equal(runtimeSurfaces.units.some((entry) => entry.name === 'cortex-oracle-executor.service'), true);

const policy = JSON.parse(read('config/canonical-policy/inference-policy.json'));
assert.equal(policy.current.oauthPolicyId, 'pmhnp_oauth_approved_2026-09-25');
assert.equal(policy.current.model, 'gpt-5.6-sol');
assert.equal(policy.current.reasoningEffort, 'xhigh');
assert.equal(policy.current.serviceTierPolicy, 'provider_default_no_override');
assert.equal(policy.current.safeMode, true);
assert.equal(policy.current.externalWrites, 'restricted');
assert.deepEqual(
  policy.superseded.map((entry) => entry.policy).sort(),
  ['forced_fast_or_priority_service_tier', 'personal_oauth_account', 'reasoning_effort_ultra'],
);

for (const file of ['USER.md', 'TOOLS.md', 'MEMORY.md']) {
  const text = read(`deploy/openclaw-policy/${file}`);
  assert.match(text, /PMHNP OAuth account/i);
  assert.match(text, /xhigh/);
  assert.match(text, /normal|provider.default/i);
  assert.match(text, /supersed/i);
}
assert.match(read('deploy/openclaw-policy/TOOLS.md'), /Attachments remain available/);
assert.match(read('deploy/openclaw-policy/TOOLS.md'), /untrusted data/);

focused(process.execPath, [
  '--test',
  '--test-name-pattern=attachment content is marked untrusted|internal oracle bridge sessions bypass route injection entirely',
  'plugins/cortex-route-gate/context-integrity.test.mjs',
  'plugins/cortex-route-gate/creativity-governor.test.mjs',
]);
focused(process.execPath, [
  '--test',
  '--test-name-pattern=accepts exactly one ordered result|rejects superseded reasoning',
  'scripts/codex-worker-launcher.test.mjs',
]);
const python = process.env.CORTEX_PYTHON;
assert.ok(python, 'CORTEX_PYTHON must preserve the integration runner interpreter');
focused(python, [
  '-m', 'unittest',
  'deploy.test_oracle_executor_session_ids.OracleExecutorSessionTests.test_local_executor_requires_service_owned_openclaw_state',
  'deploy.test_oracle_executor_session_ids.OracleExecutorSessionTests.test_local_executor_forbids_gateway_session_reset',
  'deploy.test_oracle_executor_session_ids.OracleExecutorSessionTests.test_local_cleanup_prunes_old_and_excess_sessions',
  'deploy.test_oracle_executor_session_ids.OracleExecutorSessionTests.test_all_oracle_executors_default_to_xhigh_and_reject_downgrades',
  'deploy.test_oracle_executor_session_ids.OracleExecutorSessionTests.test_all_oracle_invocations_pass_xhigh_to_openclaw',
  'deploy.test_oracle_executor_session_ids.OracleExecutorSessionTests.test_all_oracle_executors_require_auth_and_sign_bound_receipts',
]);
focused(python, [
  '-m', 'pytest', '-q',
  'public/cortex_server/tests/test_q9_release_tooling.py::test_oracle_helper_environment_is_token_only',
  'public/cortex_server/tests/test_q9_release_tooling.py::test_oracle_auth_preflight_binds_only_approved_runtime_profile',
]);

process.stdout.write('PASS cortex security/policy smoke: least privilege, canonical policy, signed Oracle helper, and attachment gate\n');
