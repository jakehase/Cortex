import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertAuthorityBindings,
  authorityKeyId,
  readAuthorityJson,
  readAuthoritySecret,
  readRootBrokeredAuthorityJson,
} from '../src/authority-input.mjs';

const secret = 'authority-input-fixture-secret-000000000000000000000';
const closRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function withRoot(label, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `clos-authority-${label}-`));
  fs.chmodSync(root, 0o700);
  try {
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeJson(target, value) {
  fs.writeFileSync(target, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

function assertCandidateRenameDenied(source, target) {
  if (typeof process.geteuid === 'function' && process.geteuid() === 0) {
    const attempt = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      [
        "import fs from 'node:fs';",
        'try {',
        'fs.renameSync(process.argv[1], process.argv[2]);',
        'process.exit(3);',
        '} catch (error) {',
        "if (!['EACCES', 'EPERM'].includes(error.code)) {",
        'console.error(error.stack || error);',
        'process.exit(2);',
        '}',
        '}',
      ].join(''),
      source,
      target,
    ], {
      encoding: 'utf8',
      gid: 65534,
      timeout: 10_000,
      uid: 65534,
    });
    assert.equal(attempt.status, 0, attempt.stderr || attempt.stdout);
    return;
  }
  assert.throws(
    () => fs.renameSync(source, target),
    /EACCES|EPERM/,
  );
}

test('authority JSON reader returns one descriptor-bound in-memory snapshot', () => {
  withRoot('snapshot', (root) => {
    const target = path.join(root, 'plan.json');
    writeJson(target, { identity: 'original' });
    const loaded = readAuthorityJson(target, 'fixture plan');
    assert.deepEqual(loaded.record, { identity: 'original' });
    assert.deepEqual(loaded.consumed, { identity: 'original' });
    assert.equal(loaded.consumedUnderPinnedDescriptor, true);
    assert.equal(loaded.identity.nlink, 1);
    assert.equal(loaded.identity.mode, '0600');
  });
});

test('authority JSON and secret decisions reject final substitution after synchronous consumption', () => {
  withRoot('protected-consumer', (root) => {
    const target = path.join(root, 'plan.json');
    const replacement = path.join(root, 'replacement.json');
    writeJson(target, { identity: 'authenticated-original' });
    writeJson(replacement, { identity: 'hostile-replacement' });
    let consumedBeforeFinalMutation = false;
    assert.throws(
      () => readAuthorityJson(target, 'fixture plan', {
        fixtureOnly: true,
        consume(record, identity) {
          assert.deepEqual(record, { identity: 'authenticated-original' });
          assert.equal(identity.path, target);
          consumedBeforeFinalMutation = true;
          return record.identity;
        },
        observer(phase) {
          if (phase === 'before_return') {
            assert.equal(consumedBeforeFinalMutation, true);
            fs.renameSync(replacement, target);
          }
        },
      }),
      /changed across its protected consumer handoff/,
    );
    assert.equal(consumedBeforeFinalMutation, true);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(target, 'utf8')),
      { identity: 'hostile-replacement' },
    );

    const secretPath = path.join(root, 'qualification.hmac');
    const secretReplacement = path.join(root, 'replacement.hmac');
    const hostileSecret = 'hostile-authority-secret-000000000000000000000000';
    fs.writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
    fs.writeFileSync(secretReplacement, `${hostileSecret}\n`, { mode: 0o600 });
    let secretConsumedBeforeFinalMutation = false;
    assert.throws(
      () => readAuthoritySecret(secretPath, {
        expectedKeyId: authorityKeyId(secret),
        fixtureOnly: true,
        consume(value) {
          assert.equal(value, secret);
          secretConsumedBeforeFinalMutation = true;
          return authorityKeyId(value);
        },
        observer(phase) {
          if (phase === 'before_return') {
            assert.equal(secretConsumedBeforeFinalMutation, true);
            fs.renameSync(secretReplacement, secretPath);
          }
        },
      }),
      /changed across its protected consumer handoff/,
    );
    assert.equal(secretConsumedBeforeFinalMutation, true);
    assert.equal(fs.readFileSync(secretPath, 'utf8').trim(), hostileSecret);
  });
});

test('authority JSON and secret consumers cannot defer protected decisions', () => {
  withRoot('async-consumer', (root) => {
    const target = path.join(root, 'plan.json');
    writeJson(target, { identity: 'synchronous-only' });
    assert.throws(
      () => readAuthorityJson(target, 'fixture plan', {
        consume: async (record) => record.identity,
      }),
      /protected consumer must complete synchronously/,
    );

    const secretPath = path.join(root, 'qualification.hmac');
    fs.writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
    assert.throws(
      () => readAuthoritySecret(secretPath, {
        expectedKeyId: authorityKeyId(secret),
        consume: async (value) => value,
      }),
      /protected consumer must complete synchronously/,
    );
  });
});

test('authority JSON and secret readers reject non-UTF-8 byte aliases', () => {
  withRoot('strict-utf8', (root) => {
    const jsonPath = path.join(root, 'plan.json');
    fs.writeFileSync(
      jsonPath,
      Buffer.from([
        ...Buffer.from('{"identity":"'),
        0xc3,
        0x28,
        ...Buffer.from('"}\n'),
      ]),
      { mode: 0o600 },
    );
    assert.throws(
      () => readAuthorityJson(jsonPath, 'fixture plan'),
      /not strict UTF-8/,
    );

    const secretPath = path.join(root, 'qualification.hmac');
    fs.writeFileSync(
      secretPath,
      Buffer.concat([
        Buffer.from('authority-input-fixture-secret-'),
        Buffer.from([0xc3, 0x28]),
        Buffer.from('-00000000000000000000000000000000\n'),
      ]),
      { mode: 0o600 },
    );
    assert.throws(
      () => readAuthoritySecret(secretPath, {
        expectedKeyId: authorityKeyId(secret),
      }),
      /not strict UTF-8/,
    );
  });
});

test('authority JSON reader rejects duplicate-key and numeric lexical aliases', () => {
  withRoot('ambiguous-json', (root) => {
    const target = path.join(root, 'plan.json');
    for (const bytes of [
      '{"identity":"selected","identity":"replacement"}\n',
      '{"schemaVersion":"authority.fixture.v1","revision":1e0}\n',
      '{ "identity": "whitespace-alias" }\n',
    ]) {
      fs.writeFileSync(target, bytes, { mode: 0o600 });
      assert.throws(
        () => readAuthorityJson(target, 'fixture plan'),
        /exact deterministic JSON encoding/,
      );
    }
    writeJson(target, {
      identity: 'deterministic',
      revision: 1,
    });
    assert.deepEqual(
      readAuthorityJson(target, 'fixture plan').record,
      { identity: 'deterministic', revision: 1 },
    );
  });
});

test('authority JSON reader rejects a pathname replacement during the read', () => {
  withRoot('replace', (root) => {
    const target = path.join(root, 'plan.json');
    const replacement = path.join(root, 'replacement.json');
    writeJson(target, { identity: 'original' });
    writeJson(replacement, { identity: 'replacement' });
    assert.throws(() => readAuthorityJson(target, 'fixture plan', {
      fixtureOnly: true,
      observer(phase) {
        if (phase === 'after_read') fs.renameSync(replacement, target);
      },
    }), /changed while its authenticated snapshot was read/);
  });
});

test('authority consumer rejects a final same-inode rewrite', () => {
  withRoot('memory', (root) => {
    const target = path.join(root, 'plan.json');
    writeJson(target, { identity: 'authenticated-original' });
    const originalIdentity = fs.statSync(target, { bigint: true });
    assert.throws(
      () => readAuthorityJson(target, 'fixture plan', {
        fixtureOnly: true,
        observer(phase) {
          if (phase === 'before_return') {
            writeJson(target, { identity: 'hostile-replacement' });
          }
        },
      }),
      /changed across its protected consumer handoff/,
    );
    const changedIdentity = fs.statSync(target, { bigint: true });
    assert.equal(changedIdentity.dev, originalIdentity.dev);
    assert.equal(changedIdentity.ino, originalIdentity.ino);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(target, 'utf8')),
      { identity: 'hostile-replacement' },
    );
  });
});

test('authority consumer rejects final deletion after protected consumption', () => {
  withRoot('delete-after-consume', (root) => {
    const target = path.join(root, 'plan.json');
    writeJson(target, { identity: 'authenticated-original' });
    let consumed = false;
    assert.throws(
      () => readAuthorityJson(target, 'fixture plan', {
        fixtureOnly: true,
        consume(record) {
          consumed = true;
          return record.identity;
        },
        observer(phase) {
          if (phase === 'before_return') fs.unlinkSync(target);
        },
      }),
      /changed across its protected consumer handoff/,
    );
    assert.equal(consumed, true);
    assert.equal(fs.existsSync(target), false);
  });
});

test('authority consumer rejects a parent-name swap across the pinned ancestor chain', () => {
  withRoot('parent-swap', (root) => {
    const authority = path.join(root, 'authority');
    const displaced = path.join(root, 'authority-displaced');
    fs.mkdirSync(authority, { mode: 0o700 });
    const target = path.join(authority, 'plan.json');
    writeJson(target, { identity: 'pinned-parent-original' });
    let swapped = false;
    assert.throws(
      () => readAuthorityJson(target, 'fixture plan', {
        fixtureOnly: true,
        observer(phase) {
          if (phase !== 'after_open' || swapped) return;
          swapped = true;
          fs.renameSync(authority, displaced);
          fs.mkdirSync(authority, { mode: 0o700 });
          writeJson(target, { identity: 'hostile-new-parent' });
        },
      }),
      /ancestor identity changed while reading|changed while its authenticated snapshot was read/,
    );
    assert.equal(swapped, true);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(target, 'utf8')),
      { identity: 'hostile-new-parent' },
    );
  });
});

test('authority consumer rejects a parent-name swap after protected consumption', () => {
  withRoot('parent-swap-after-consume', (root) => {
    const authority = path.join(root, 'authority');
    const displaced = path.join(root, 'authority-displaced');
    fs.mkdirSync(authority, { mode: 0o700 });
    const target = path.join(authority, 'plan.json');
    writeJson(target, { identity: 'pinned-parent-original' });
    let consumed = false;
    let swapped = false;
    assert.throws(
      () => readAuthorityJson(target, 'fixture plan', {
        fixtureOnly: true,
        consume(record) {
          assert.deepEqual(record, { identity: 'pinned-parent-original' });
          consumed = true;
          return record.identity;
        },
        observer(phase) {
          if (phase !== 'before_return' || swapped) return;
          assert.equal(consumed, true);
          swapped = true;
          fs.renameSync(authority, displaced);
          fs.mkdirSync(authority, { mode: 0o700 });
          writeJson(target, { identity: 'hostile-new-parent' });
        },
      }),
      /ancestor identity changed while reading|changed across its protected consumer handoff/,
    );
    assert.equal(consumed, true);
    assert.equal(swapped, true);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(target, 'utf8')),
      { identity: 'hostile-new-parent' },
    );
  });
});

test('authority ancestor identity tolerates unrelated sticky-root link-count churn', () => {
  withRoot('sticky-ancestor-churn', (root) => {
    const target = path.join(root, 'plan.json');
    writeJson(target, { identity: 'stable-private-parent' });
    let unrelated = null;
    try {
      const loaded = readAuthorityJson(target, 'fixture plan', {
        fixtureOnly: true,
        observer(phase) {
          if (phase === 'after_open' && unrelated === null) {
            unrelated = fs.mkdtempSync(path.join(
              os.tmpdir(),
              'clos-unrelated-authority-churn-',
            ));
          }
        },
      });
      assert.deepEqual(loaded.record, {
        identity: 'stable-private-parent',
      });
    } finally {
      if (unrelated !== null) {
        fs.rmSync(unrelated, { recursive: true, force: true });
      }
    }
  });
});

test('authority readers require stable parent metadata by default', () => {
  withRoot('default-parent-stability', (root) => {
    const target = path.join(root, 'plan.json');
    writeJson(target, { identity: 'original' });
    assert.throws(
      () => readAuthorityJson(target, 'fixture plan', {
        fixtureOnly: true,
        observer(phase) {
          if (phase === 'after_read') fs.chmodSync(root, 0o500);
        },
      }),
      /changed while its authenticated snapshot was read/,
    );
    fs.chmodSync(root, 0o700);
    assert.throws(
      () => readAuthorityJson(target, 'fixture plan', {
        requireStableParent: false,
      }),
      /snapshot policy is invalid/,
    );
  });
});

test('authority reader rejects links, unsafe modes, and writable ancestors', () => {
  withRoot('metadata', (root) => {
    const target = path.join(root, 'plan.json');
    writeJson(target, { identity: 'original' });
    const symlink = path.join(root, 'symlink.json');
    fs.symlinkSync(target, symlink);
    assert.throws(
      () => readAuthorityJson(symlink, 'fixture plan'),
      /must not be a symbolic link/,
    );

    const hardlink = path.join(root, 'hardlink.json');
    fs.linkSync(target, hardlink);
    assert.throws(
      () => readAuthorityJson(target, 'fixture plan'),
      /single-link regular file/,
    );
    fs.unlinkSync(hardlink);

    fs.chmodSync(target, 0o644);
    assert.throws(
      () => readAuthorityJson(target, 'fixture plan'),
      /exact trusted ownership and mode/,
    );
    fs.chmodSync(target, 0o600);
    fs.chmodSync(root, 0o770);
    assert.throws(
      () => readAuthorityJson(target, 'fixture plan'),
      /ancestor is unsafe|parent is unsafe/,
    );
  });
});

test('authority reader can require a stable non-writable broker handoff', () => {
  withRoot('sealed-parent', (root) => {
    const target = path.join(root, 'campaign.json');
    const replacement = path.join(root, 'replacement.json');
    writeJson(target, { identity: 'sealed-authority' });
    writeJson(replacement, { identity: 'hostile-replacement' });
    fs.chmodSync(target, 0o400);
    fs.chmodSync(replacement, 0o400);
    fs.chmodSync(root, 0o500);
    try {
      const loaded = readAuthorityJson(target, 'sealed campaign', {
        allowedModes: [0o400],
        allowedParentModes: [0o500],
        requireStableParent: true,
      });
      assert.deepEqual(loaded.record, { identity: 'sealed-authority' });
      assert.equal(loaded.parentIdentity.mode, '0500');
      assertCandidateRenameDenied(replacement, target);

      assert.throws(
        () => readAuthorityJson(target, 'unsealed campaign', {
          allowedModes: [0o400],
          allowedParentModes: [0o500],
          fixtureOnly: true,
          requireStableParent: true,
          observer(phase) {
            if (phase === 'after_read') fs.chmodSync(root, 0o700);
          },
        }),
        /changed while its authenticated snapshot was read/,
      );
    } finally {
      fs.chmodSync(root, 0o700);
      fs.chmodSync(target, 0o600);
      if (fs.existsSync(replacement)) fs.chmodSync(replacement, 0o600);
    }
  });
});

test('authority secret and campaign identities require independent pins', () => {
  withRoot('bindings', (root) => {
    const secretPath = path.join(root, 'qualification.hmac');
    fs.writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
    const keyId = authorityKeyId(secret);
    const loadedSecret = readAuthoritySecret(secretPath, {
      expectedKeyId: keyId,
    });
    assert.equal(loadedSecret.secret, secret);
    assert.equal(loadedSecret.consumed, secret);
    assert.equal(loadedSecret.consumedUnderPinnedDescriptor, true);
    assert.throws(
      () => readAuthoritySecret(secretPath, { expectedKeyId: '0'.repeat(16) }),
      /independently configured key ID/,
    );
    const expected = {
      subjectId: 'candidate-one',
      campaignDigest: '1'.repeat(64),
      deploymentDigest: '2'.repeat(64),
      keyId,
    };
    assert.equal(assertAuthorityBindings(expected, expected), true);
    assert.throws(() => assertAuthorityBindings({
      ...expected,
      subjectId: 'candidate-two',
    }, expected), /independently configured authority identity/);
  });
});

test('authority secret replacement cannot cross the descriptor-bound key identity', () => {
  withRoot('secret-replacement', (root) => {
    const target = path.join(root, 'qualification.hmac');
    const replacement = path.join(root, 'replacement.hmac');
    const hostileSecret = 'hostile-authority-secret-000000000000000000000000';
    fs.writeFileSync(target, `${secret}\n`, { mode: 0o600 });
    fs.writeFileSync(replacement, `${hostileSecret}\n`, { mode: 0o600 });
    assert.throws(() => readAuthoritySecret(target, {
      expectedKeyId: authorityKeyId(secret),
      fixtureOnly: true,
      observer(phase) {
        if (phase === 'after_read') fs.renameSync(replacement, target);
      },
    }), /changed while its authenticated snapshot was read/);
    assert.equal(fs.readFileSync(target, 'utf8').trim(), hostileSecret);
  });
});

test('authority race observers are unavailable to production readers', () => {
  withRoot('observer-policy', (root) => {
    const target = path.join(root, 'plan.json');
    writeJson(target, { identity: 'production-reader' });
    assert.throws(
      () => readAuthorityJson(target, 'production plan', {
        observer() {},
      }),
      /snapshot policy is invalid/,
    );
    const secretPath = path.join(root, 'qualification.hmac');
    fs.writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
    assert.throws(
      () => readAuthoritySecret(secretPath, {
        expectedKeyId: authorityKeyId(secret),
        observer() {},
      }),
      /snapshot policy is invalid/,
    );
  });
});

test('production consumers reject caller-owned lookalikes for brokered immutable objects', {
  skip: typeof process.geteuid !== 'function' || process.geteuid() === 0,
}, () => {
  withRoot('broker-lookalike', (root) => {
    const record = { identity: 'caller-owned-lookalike' };
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const target = path.join(root, 'campaign.json');
    const objectDirectory = path.join(root, '.authenticated-objects');
    fs.mkdirSync(objectDirectory, { mode: 0o700 });
    fs.writeFileSync(target, bytes, { mode: 0o400 });
    fs.writeFileSync(path.join(objectDirectory, `${digest}.json`), bytes, {
      mode: 0o400,
    });
    fs.chmodSync(objectDirectory, 0o500);
    try {
      assert.throws(
        () => readRootBrokeredAuthorityJson(target, 'production campaign', {
          consume: (candidate) => candidate,
        }),
        /production root authority requires|ancestor is unsafe|parent is unsafe|exact trusted ownership and mode/,
      );
    } finally {
      fs.chmodSync(objectDirectory, 0o700);
    }
  });
});

test('production brokered readers require synchronous protected consumption', () => {
  assert.throws(
    () => readRootBrokeredAuthorityJson(
      '/nonexistent/production-campaign.json',
      'production campaign',
    ),
    /requires a synchronous protected consumer/,
  );
});

test('production authority entrypoints verify selected plans and bundles inside protected consumers', () => {
  const sources = Object.fromEntries([
    'phd-qualification-control.mjs',
    'phd-qualification-launch.mjs',
    'proof-runtime-attestation-request.mjs',
    'require-phd-gate.mjs',
  ].map((name) => [
    name,
    fs.readFileSync(path.join(closRoot, 'src', name), 'utf8'),
  ]));
  assert.match(
    sources['phd-qualification-control.mjs'],
    /readJson\(bundlePath, consumeControlBundle\)/,
  );
  assert.match(
    sources['phd-qualification-control.mjs'],
    /const consumeControlBundle = \(candidate\) => \{[\s\S]+validateProductionControlBundle[\s\S]+assertAuthorityBindings/,
  );
  assert.match(
    sources['phd-qualification-launch.mjs'],
    /readRegularJson\(planPath, 'qualification plan', \{[\s\S]+consume:[\s\S]+verifyQualificationLaunchPlan/,
  );
  assert.match(
    sources['proof-runtime-attestation-request.mjs'],
    /readAuthorityJson\([\s\S]+consume\(candidate\) \{[\s\S]+verifyQualificationLaunchPlan[\s\S]+\)[.]consumed/,
  );
  assert.match(
    sources['require-phd-gate.mjs'],
    /readRequired\('CLOS_QUALIFICATION_PLAN', \{[\s\S]+consume\([\s\S]+authenticatedQualificationDeployment/,
  );
});
