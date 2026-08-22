import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { bootstrapSurfaceHonestyManifest, enforceArchitecture, evaluateArchitectureBudget } from '../packages/architecture-enforcer/index.mjs';

test('flags single-file collapse and missing monorepo structure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-enforcer-'));
  fs.mkdirSync(path.join(dir, 'packages', 'a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'packages', 'a', 'index.mjs'), Array.from({ length: 450 }, () => 'export const x = 1;').join('\n'));
  const report = enforceArchitecture(dir, { maxSourceLines: 100 });
  assert.equal(report.ok, false);
  assert.ok(report.violations.some((entry) => entry.rule === 'required-top-level-dir'));
  assert.ok(report.violations.some((entry) => entry.rule === 'anti-collapse-max-lines'));
});

test('evaluates claim-sensitive architecture budgets without naïve line-count absolutism', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-budget-'));
  for (const folder of ['apps/web', 'packages/app/routes', 'packages/campaign', 'tests', 'docs', 'artifacts']) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
  }

  const productFiles = [
    'apps/web/server.mjs',
    'apps/web/render.mjs',
    'packages/app/index.mjs',
    'packages/app/domain-core.mjs',
    'packages/app/routes/dashboard.mjs',
    'packages/app/routes/campaigns.mjs',
    'packages/campaign/index.mjs',
    'packages/campaign/reporting.mjs'
  ];
  for (const file of productFiles) {
    fs.writeFileSync(path.join(dir, file), Array.from({ length: 120 }, () => 'export const x = 1;').join('\n'));
  }
  for (let i = 0; i < 5; i += 1) {
    fs.writeFileSync(path.join(dir, 'tests', `suite-${i}.test.mjs`), Array.from({ length: 80 }, () => 'export const ok = true;').join('\n'));
  }

  const budget = evaluateArchitectureBudget(dir);
  assert.equal(budget.claims.production_slice.eligible, true);
  assert.equal(budget.claims.full_clone_credible.eligible, false);
  assert.ok(budget.claims.full_clone_credible.reasons.some((reason) => reason.includes('package_count_below_4') || reason.includes('product_source_lines_below_12000')));
});

test('surface-honesty gate flags changed product files that are undeclared', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-honesty-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  for (const folder of ['apps/web', 'packages/app/routes', 'tests', 'docs', 'artifacts']) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'apps/web/server.mjs'), 'export const server = true;\n');
  fs.writeFileSync(path.join(dir, 'packages/app/routes/dashboard.mjs'), 'export const dashboard = true;\n');
  const report = enforceArchitecture(dir);
  assert.equal(report.honesty.ok, false);
  assert.ok(report.honesty.violations.some((entry) => entry.rule === 'surface-honesty-missing'));

  fs.writeFileSync(path.join(dir, 'surface-honesty.json'), JSON.stringify({
    version: 1,
    surfaces: {
      'apps/web/server.mjs': { label: 'web server', status: 'real', evidence: { tests: ['tests/web.test.mjs'] } },
      'packages/app/routes/dashboard.mjs': { label: 'dashboard route', status: 'real', evidence: { tests: ['tests/dashboard.test.mjs'] } }
    }
  }, null, 2));

  const green = enforceArchitecture(dir);
  assert.equal(green.honesty.ok, true);
});

test('bootstrapSurfaceHonestyManifest creates a starter manifest for changed product files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-honesty-bootstrap-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  for (const folder of ['apps/web', 'packages/app/routes', 'tests', 'docs', 'artifacts']) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'apps/web/server.mjs'), 'export const server = true;\n');
  fs.writeFileSync(path.join(dir, 'packages/app/routes/dashboard.mjs'), 'export const dashboard = true;\n');

  const bootstrap = bootstrapSurfaceHonestyManifest(dir);
  assert.equal(bootstrap.created, true);
  assert.ok(fs.existsSync(path.join(dir, 'surface-honesty.json')));
  assert.ok(bootstrap.manifest.surfaces['apps/web/server.mjs']);
  assert.equal(bootstrap.manifest.surfaces['apps/web/server.mjs'].status, 'declare_me');
  assert.ok(bootstrap.manifest.surfaces['packages/app/routes/dashboard.mjs']);

  const report = enforceArchitecture(dir);
  assert.equal(report.honesty.ok, false);
  assert.ok(report.honesty.violations.some((entry) => entry.rule === 'surface-honesty-status'));
});
