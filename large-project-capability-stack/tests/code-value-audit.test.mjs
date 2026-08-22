import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCodeValueAudit } from '../packages/code-value-audit/index.mjs';

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('code value audit classifies core app, support scripts, and generated breadth separately', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-value-audit-'));

  write(path.join(root, 'packages/app/routes/campaigns.mjs'), 'export const x = 1;\n'.repeat(10));
  write(path.join(root, 'apps/web/server.mjs'), 'export const web = true;\n'.repeat(5));
  write(path.join(root, 'scripts/worker.mjs'), 'console.log("worker");\n'.repeat(7));
  write(path.join(root, 'packages/growth-grid/index.mjs'), 'export const growth = true;\n'.repeat(20));
  write(path.join(root, 'tests/platform-spine.test.mjs'), 'test();\n'.repeat(8));
  write(path.join(root, 'tests/growth-grid.test.mjs'), 'test();\n'.repeat(12));
  write(path.join(root, 'scripts/generate-loc-500k-expansion.mjs'), "const PACKAGE_NAMES = ['growth-grid'];\n");

  const audit = buildCodeValueAudit({ repoRoot: root });

  assert.equal(audit.totals.files, 6);
  assert.ok(audit.buckets.deep_product_parity_code.lines > 0);
  assert.ok(audit.buckets.support_runtime_evidence_code.lines > 0);
  assert.ok(audit.buckets.mass_generated_or_shallow_expansion.lines > 0);
  assert.equal(
    audit.fileRows.find((row) => row.path === 'packages/app/routes/campaigns.mjs').bucket,
    'deep_product_parity_code'
  );
  assert.equal(
    audit.fileRows.find((row) => row.path === 'scripts/worker.mjs').bucket,
    'support_runtime_evidence_code'
  );
  assert.equal(
    audit.fileRows.find((row) => row.path === 'packages/growth-grid/index.mjs').bucket,
    'mass_generated_or_shallow_expansion'
  );
  assert.equal(
    audit.fileRows.find((row) => row.path === 'tests/growth-grid.test.mjs').bucket,
    'mass_generated_or_shallow_expansion'
  );
});
