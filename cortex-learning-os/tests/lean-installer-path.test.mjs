import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALLER = path.join(ROOT, 'scripts/install-lean-proof-kernel.sh');
const EXPECTED_VERSION = 'Lean (version 4.32.1, x86_64-unknown-linux-gnu, commit f054605aea4b840552cca2e725580bffd1e1b704, Release)';
const ARCHIVE_SHA256 = '57d5c062a6b4bae6fba511a1704aa124dff461c37d0fc94585637fbb7d951b50';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('Lean installer makes the exact verified toolchain authoritative for Lake subprocesses', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-lean-installer-path-'));
  try {
    const kernelRoot = path.join(temp, 'proof-kernel');
    const runtimeRoot = path.join(temp, 'runtime');
    const installRoot = path.join(temp, 'lean-4.32.1-linux');
    const binRoot = path.join(installRoot, 'bin');
    const marker = path.join(temp, 'lake-environment.json');
    fs.mkdirSync(kernelRoot, { recursive: true });
    fs.mkdirSync(binRoot, { recursive: true });
    for (const relative of [
      'lean-toolchain',
      'lakefile.toml',
      'ProofKernel.lean',
      'ProofKernel/Prelude.lean',
      'ProofKernel/Representative.lean',
    ]) {
      const target = path.join(kernelRoot, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'proof-kernel', relative), target);
    }

    const leanPath = path.join(binRoot, 'lean');
    const lakePath = path.join(binRoot, 'lake');
    fs.writeFileSync(leanPath, `#!/usr/bin/env bash\nset -euo pipefail\ncase "${'$'}{1:-}" in\n  --version) printf '%s\\n' '${EXPECTED_VERSION}' ;;\n  --print-prefix) cd -- "${'$'}(dirname -- "${'$'}(dirname -- "${'$'}0")")"; pwd -P ;;\n  *) exit 64 ;;\nesac\n`, { mode: 0o755 });
    fs.writeFileSync(lakePath, `#!/usr/bin/env bash\nset -euo pipefail\npython3 - "${'$'}CORTEX_TEST_PATH_MARKER" "${'$'}PATH" "${'$'}(command -v lean)" <<'PY'\nimport json,sys\njson.dump({'path':sys.argv[2], 'resolvedLean':sys.argv[3], 'args':sys.argv[4:]}, open(sys.argv[1], 'w'))\nPY\nexit 41\n`, { mode: 0o755 });

    fs.writeFileSync(path.join(installRoot, 'cortex-proof-kernel-installation.json'), `${JSON.stringify({
      schemaVersion: 'cortex.learning_os.lean_proof_installation.v1',
      leanRelease: 'v4.32.1',
      leanToolchain: 'leanprover/lean4:v4.32.1',
      leanCommit: 'f054605aea4b840552cca2e725580bffd1e1b704',
      leanArchiveSha256: ARCHIVE_SHA256,
      leanExecutableSha256: sha256File(leanPath),
      lakeExecutableSha256: sha256File(lakePath),
    }, null, 2)}\n`, { mode: 0o600 });

    const result = spawnSync(INSTALLER, [
      '--kernel-root', kernelRoot,
      '--runtime-root', runtimeRoot,
      '--install-root', installRoot,
    ], {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: '/usr/bin:/bin',
        CORTEX_TEST_PATH_MARKER: marker,
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 41, `${result.stdout}\n${result.stderr}`);
    const observed = JSON.parse(fs.readFileSync(marker, 'utf8'));
    assert.equal(observed.resolvedLean, leanPath);
    assert.equal(observed.path.split(':')[0], binRoot);
    assert.match(result.stdout, /Exact Lean installation already present/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
