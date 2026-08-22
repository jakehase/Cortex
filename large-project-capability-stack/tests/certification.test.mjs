import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { certifyClaim } from '../packages/certification/index.mjs';

function writeLines(filePath, count, line = 'export const value = 1;') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Array.from({ length: count }, () => line).join('\n'));
}

test('evidence-weighted certification downgrades small repos away from full clone claims', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'certification-'));
  for (const folder of ['apps/web', 'packages/app/routes', 'packages/campaign', 'tests', 'docs', 'artifacts']) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
  }

  const productFiles = [
    'apps/web/server.mjs',
    'apps/web/render.mjs',
    'packages/app/index.mjs',
    'packages/app/domain-core.mjs',
    'packages/app/domain-audience.mjs',
    'packages/app/domain-campaigns.mjs',
    'packages/app/routes/dashboard.mjs',
    'packages/app/routes/campaigns.mjs',
    'packages/app/routes/audiences.mjs',
    'packages/campaign/index.mjs',
    'packages/campaign/delivery.mjs',
    'packages/campaign/reporting.mjs'
  ];
  for (const file of productFiles) writeLines(path.join(dir, file), 150);
  for (let i = 0; i < 5; i += 1) writeLines(path.join(dir, 'tests', `surface-${i}.test.mjs`), 100, 'export const testCase = true;');

  const certification = certifyClaim({
    repoRoot: dir,
    requestedClaim: 'full_clone_credible',
    evidenceArtifacts: [
      path.join(dir, 'artifacts', 'architecture.json'),
      path.join(dir, 'artifacts', 'parity.json'),
      path.join(dir, 'artifacts', 'supervisor.json'),
      path.join(dir, 'artifacts', 'watch.json'),
      path.join(dir, 'artifacts', 'notify.json')
    ],
    repoTestsOk: true,
    targetTestsOk: true,
    supervisorOk: true,
    notifyOk: true,
    parityReport: {
      ok: true,
      passed: 4,
      evidence: {
        mode: 'http',
        browser: { available: false, real: false, driver: 'none' }
      },
      browserAdapter: {
        ok: true,
        passed: 2,
        evidence: {
          mode: 'browser_adapter',
          browser: { available: true, real: false, driver: 'simulated' }
        }
      }
    }
  });

  assert.equal(certification.statusFlags.scoped_completion_green, true);
  assert.equal(certification.statusFlags.parity_for_scope_plausible, true);
  assert.equal(certification.statusFlags.full_clone_credible, false);
  assert.equal(certification.statusFlags.large_product_replica, false);
  assert.equal(certification.statusFlags.real_world_indistinguishable_not_proven, true);
  assert.equal(certification.highestAllowedClaim, 'scoped_parity');
  assert.equal(certification.requestedClaimAllowed, false);
  assert.ok(certification.claims.full_clone_credible.reasons.includes('no_real_browser_proof'));
  assert.ok(certification.claims.large_product_replica.reasons.includes('code_volume_too_small_for_large_product_replica'));
});
