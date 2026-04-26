import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTaskContract, parseTaskContract, validateTaskContract } from '../packages/task-contract/index.mjs';

test('compiles and validates machine-readable task contracts', () => {
  const contract = compileTaskContract({
    anchor: 'anchor',
    replyAnchor: 'reply',
    targetPath: '/tmp/demo',
    requestedFidelity: 'production_slice',
    requestedScope: ['X1', 'X2'],
    stopCondition: 'supervisor_green_or_blocker_report',
    blockerPolicy: 'require_blocker_report_when_red',
    evidenceRequirements: ['tests']
  });
  assert.equal(contract.replyAnchor, 'reply');
  assert.equal(validateTaskContract(contract).ok, true);
});

test('parses markdown-ish contract text', () => {
  const parsed = parseTaskContract(`Anchor: alpha
Reply anchor: beta
Target path: /tmp/example
Scope: X1, X2`);
  assert.equal(parsed.anchor, 'alpha');
  assert.equal(parsed.reply_anchor, 'beta');
  assert.equal(parsed.target_path, '/tmp/example');
});
