import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IMPLEMENT_SCRIPT = path.join(ROOT, 'scripts', 'orchestrator-real-repo-clean-implement.mjs');

function mkWorkspace(relativeFiles) {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-implement-regression-'));
  for (const relPath of relativeFiles) {
    const source = path.join(ROOT, relPath);
    const target = path.join(workspacePath, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  return workspacePath;
}

function runFocusGroup(relativeFiles, focusGroup) {
  const workspacePath = mkWorkspace(relativeFiles);
  const assignmentPath = path.join(workspacePath, 'assignment.json');
  fs.writeFileSync(assignmentPath, JSON.stringify({ targetPath: workspacePath, issue: { inputs: { focusGroup } } }, null, 2));
  const result = spawnSync(process.execPath, [IMPLEMENT_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40
  });
  assert.equal(result.status, 0, `focusGroup ${focusGroup} should succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return { workspacePath, result };
}

test('implement worker: frontend architecture keeps builder overlay non-interactive', () => {
  const { workspacePath } = runFocusGroup(['packages/app/view.mjs'], 'frontend_architecture');
  const css = fs.readFileSync(path.join(workspacePath, 'apps/web/public/app-shell.css'), 'utf8');
  assert.match(css, /\[data-builder-panel\][\s\S]*pointer-events:\s*none;/, 'builder overlay should remain non-interactive');
});

test('implement worker: persistence keeps legacy app.json fallback and adds persistState', () => {
  const { workspacePath } = runFocusGroup(['packages/app/storage.mjs'], 'persistence');
  const storage = fs.readFileSync(path.join(workspacePath, 'packages/app/storage.mjs'), 'utf8');
  assert.match(storage, /legacyDbPath:\s*path\.join\(ROOT_DIR, 'app\.json'\)/, 'legacy fallback must remain app.json');
  assert.match(storage, /export function persistState\(state\)/, 'persistState should be exported');
});

test('implement worker: integrations parity creates provider bridge and removes fabricated crm sync count', () => {
  const { workspacePath } = runFocusGroup(['packages/app/domain-integration-marketplace.mjs'], 'integrations_api_oauth');
  const domain = fs.readFileSync(path.join(workspacePath, 'packages/app/domain-integration-marketplace.mjs'), 'utf8');
  const provider = fs.readFileSync(path.join(workspacePath, 'packages/app/integration-provider.mjs'), 'utf8');
  assert.match(domain, /export async function syncMarketplaceInstallation/, 'integration sync should become async');
  assert.doesNotMatch(domain, /syncedContacts:\s*app\.category === 'crm' \? 12 : 0/, 'fabricated CRM sync counts must be removed');
  assert.match(provider, /fetch\(/, 'provider bridge should perform a real fetch-based sync call');
});

test('implement worker: security ops imports persistState correctly and emits helper modules', () => {
  const { workspacePath } = runFocusGroup(['packages/app/security.mjs', 'packages/app/storage.mjs', 'apps/web/server.mjs'], 'security_ops');
  const security = fs.readFileSync(path.join(workspacePath, 'packages/app/security.mjs'), 'utf8');
  const storage = fs.readFileSync(path.join(workspacePath, 'packages/app/storage.mjs'), 'utf8');
  assert.match(security, /import \{ persistState \} from '\.\/storage\.mjs';/, 'security should import persistState by the correct name');
  assert.doesNotMatch(security, /persistState as saveDb/, 'security should not alias persistState as saveDb');
  assert.match(security, /export function createMfaChallenge/, 'security should expose MFA challenge helper');
  assert.match(security, /export function createSsoSession/, 'security should expose SSO session helper');
  assert.match(security, /persistState\(state\);/, 'security helpers should persist via persistState');
  assert.equal((storage.match(/from '\.\/persistence-io\.mjs';/g) || []).length, 1, 'storage should import persistence IO helpers exactly once');
  assert.ok(fs.existsSync(path.join(workspacePath, 'packages/app/persistence-io.mjs')), 'persistence IO helper should be emitted');
  assert.ok(fs.existsSync(path.join(workspacePath, 'packages/app/http-runtime.mjs')), 'http runtime helper should be emitted');
});
