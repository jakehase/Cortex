import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  atomicWriteSignedControlPlaneRecord,
  verifySignedControlPlaneRecord,
} from '../src/authenticated-control-publication.mjs';
import { atomicWriteAuthenticatedJson } from '../src/authenticated-file-publication.mjs';
import {
  atomicWritePhdCampaignReport,
  PHD_CAMPAIGN_REPORT_SCHEMA,
  verifyPhdCampaignReport,
} from '../src/phd-campaign.mjs';
import {
  createExecutionEvidenceCore,
  executionEvidenceSha256,
} from '../src/execution-evidence.mjs';
import { sha256Text } from '../src/hash.mjs';

const signingSecret = 'publication-regression-secret-000000000000000000000';
// The production publisher intentionally rejects any group- or world-writable
// non-sticky ancestor. Some isolated validators point TMPDIR inside a
// group-writable checkout, so these regressions must choose the independently
// trusted sticky Linux temporary root instead of weakening that product gate.
const os = Object.freeze({ tmpdir: () => '/tmp' });
const closRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const childPath = fileURLToPath(
  new URL('./helpers/phd-publication-child.mjs', import.meta.url),
);
const rootBrokerChildPath = fileURLToPath(
  new URL('./helpers/phd-root-broker-child.mjs', import.meta.url),
);
const rootBrokerAttackerPath = fileURLToPath(
  new URL('./helpers/phd-root-broker-attacker.mjs', import.meta.url),
);
const mappedRootNamespaceAvailable = (() => {
  if (!fs.existsSync('/usr/bin/unshare')) return false;
  const probe = spawnSync('/usr/bin/unshare', [
    '--user',
    '--map-root-user',
    '/usr/bin/id',
    '-u',
  ], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  return probe.status === 0 && probe.stdout.trim() === '0';
})();

function assertCandidateRenameDenied(source, target, label) {
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
    assert.equal(attempt.status, 0, attempt.stderr || attempt.stdout || label);
    return;
  }
  assert.throws(
    () => fs.renameSync(source, target),
    /EACCES|EPERM/,
    label,
  );
}

function makeFifo(targetPath, mode = '0600') {
  const result = spawnSync('/usr/bin/mkfifo', [
    `--mode=${mode}`,
    targetPath,
  ], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}

function signReport(payload) {
  return {
    ...payload,
    controlPlaneSignature: {
      algorithm: 'hmac-sha256',
      keyId: sha256Text(signingSecret).slice(0, 16),
      digest: crypto.createHmac('sha256', signingSecret)
        .update(canonicalJson(payload))
        .digest('hex'),
    },
  };
}

function resignReport(report) {
  const {
    controlPlaneSignature: _signature,
    ...payload
  } = report;
  return signReport(payload);
}

function genericControl(marker, value = null) {
  return signReport({
    schemaVersion: 'generic.control.v1',
    publisher: marker,
    ...(value === null ? {} : { value }),
    truthBoundary: 'This signed output is a publication fixture and is not qualification evidence.',
  });
}

function campaignReport(marker) {
  return signReport({
    schemaVersion: PHD_CAMPAIGN_REPORT_SCHEMA,
    campaignId: `publication-campaign-${marker}`,
    subjectId: 'publication-subject',
    evaluatedAt: '2026-07-30T00:00:00.000Z',
    deploymentDigest: 'd'.repeat(64),
    verificationBundleSha256: null,
    qualificationHarvestBinding: null,
    layers: {
      acquisition: false,
      retention: false,
      qualification: false,
      proof: false,
      specialization: false,
      research: false,
      executionEvidence: false,
      qualificationHarvest: false,
    },
    examResults: [],
    proofResults: [],
    research: {
      passed: false,
      errors: [`publication fixture ${marker}`],
    },
    executionEvidenceRecords: [],
    blockers: [`publication-fixture:${marker}`],
    mechanicalGatesSatisfied: false,
    phd_math_qualified: false,
    claimTruth: (
      'Implementation, acquisition coverage, fixture evidence, partial campaigns, or elapsed time '
      + 'do not establish retained mastery or PhD capability.'
    ),
  });
}

function qualifiedExecutionRecord(index, report) {
  const core = createExecutionEvidenceCore({
    executionKind: 'process',
    bindings: {
      candidateId: null,
      candidateSessionId: `summary-only-session-${index}`,
      candidateSha256: String(index).repeat(64),
      taskId: `summary-only-task-${index}`,
      taskSha256: String(index + 1).repeat(64),
      jobId: `summary-only-job-${index}`,
      jobSha256: String(index + 2).repeat(64),
      campaignId: report.campaignId,
      campaignSha256: 'c'.repeat(64),
      deploymentSha256: report.deploymentDigest,
      sourceSha256: String(index + 3).repeat(64),
    },
    declaredEnvironment: { role: 'summary_only_fixture' },
    observedEnvironment: { fixture: true, index },
    requestedArgv: ['/fixture/process'],
    executedArgv: ['/fixture/process'],
    executable: {
      invoked: '/fixture/process',
      resolvedPath: '/fixture/process',
      bytes: 1,
      sha256: String(index + 4).repeat(64),
    },
    cwd: '/fixture',
    startedAt: `2026-07-30T00:00:0${index}.000Z`,
    completedAt: `2026-07-30T00:00:0${index}.001Z`,
    exitCode: 0,
    input: {
      name: 'input',
      mediaType: 'application/json',
      bytes: Buffer.from(`{"index":${index}}`),
    },
    stdout: Buffer.from(`summary-only-${index}\n`),
    stderr: Buffer.alloc(0),
    outputFiles: [],
  });
  return {
    core,
    executionEvidenceSha256: executionEvidenceSha256(core),
  };
}

function summaryOnlyQualifiedReport() {
  const report = campaignReport('summary-only-qualified');
  // A digest-shaped field is still only an index without the pinned bundle;
  // the qualified publisher below must continue to reject this summary alone.
  report.verificationBundleSha256 = '9'.repeat(64);
  report.qualificationHarvestBinding = {
    planDigest: '1'.repeat(64),
    harvestStateDigest: '2'.repeat(64),
    campaignDigest: '3'.repeat(64),
    deploymentDigest: report.deploymentDigest,
    descriptorSetSha256: '4'.repeat(64),
    jobSetSha256: '5'.repeat(64),
    jobCount: 4,
    receiptSetSha256: '6'.repeat(64),
    artifactSetSha256: '7'.repeat(64),
    modelCallSetSha256: '8'.repeat(64),
  };
  for (const layer of Object.keys(report.layers)) report.layers[layer] = true;
  report.research = { passed: true, errors: [] };
  report.executionEvidenceRecords = [1, 2, 3, 4].map((index) => (
    qualifiedExecutionRecord(index, report)
  ));
  report.blockers = [];
  report.mechanicalGatesSatisfied = true;
  report.phd_math_qualified = true;
  report.claimTruth = (
    'Every bounded production gate independently replayed for the exact deployment and subject. '
    + 'This is not a degree or model-weight claim.'
  );
  return resignReport(report);
}

function publish(mode, targetPath, value, options = {}) {
  const fixtureOptions = { fixtureOnly: true, ...options };
  if (mode === 'generic') {
    return atomicWriteSignedControlPlaneRecord(
      targetPath,
      value,
      signingSecret,
      fixtureOptions,
    );
  }
  return atomicWritePhdCampaignReport(
    targetPath,
    value,
    signingSecret,
    fixtureOptions,
  );
}

test('production publication denies an unprivileged same-UID publisher before staging', {
  skip: typeof process.geteuid !== 'function' || process.geteuid() === 0,
}, () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-production-publication-privilege-boundary-',
  ));
  try {
    const target = path.join(root, 'campaign.json');
    assert.throws(
      () => atomicWriteAuthenticatedJson(
        target,
        genericControl('unprivileged-production-attempt'),
      ),
      /production root authority requires/,
    );
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function waitForPath(target) {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(target)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${target}`);
    Atomics.wait(cell, 0, 0, 5);
  }
}

function runChild(inputPath) {
  const child = spawn(process.execPath, [childPath, inputPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return {
    child,
    completed: new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({
        code,
        signal,
        stderr,
        stdout,
      }));
    }),
  };
}

async function contend(root, mode, values, expectedExitCodes = [0, 4]) {
  const targetPath = path.join(root, `${mode}.json`);
  const startPath = path.join(root, `${mode}.start`);
  const children = values.map((value, index) => {
    const readyPath = path.join(root, `${mode}.${index}.ready`);
    const inputPath = path.join(root, `${mode}.${index}.input.json`);
    fs.writeFileSync(inputPath, `${JSON.stringify({
      mode,
      targetPath,
      readyPath,
      startPath,
      ...(mode === 'generic'
        ? { record: value, signingSecret }
        : { report: value, signingSecret }),
    }, null, 2)}\n`, { mode: 0o600 });
    return {
      readyPath,
      ...runChild(inputPath),
    };
  });
  for (const child of children) waitForPath(child.readyPath);
  fs.writeFileSync(startPath, 'start\n', { flag: 'wx', mode: 0o600 });
  const results = await Promise.all(children.map((child) => child.completed));
  assert.deepEqual(
    results.map((result) => result.code).sort(),
    expectedExitCodes,
    results.map((result) => result.stderr).join('\n'),
  );
  const published = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  assert.equal(
    values.some((value) => canonicalJson(value) === canonicalJson(published)),
    true,
  );
  assert.equal(fs.statSync(targetPath).nlink, 1);
  return { published, targetPath };
}

test('distinct generic control publishers use atomic no-replace publication', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-generic-publish-race-'));
  try {
    const values = [
      genericControl('first', 1),
      genericControl('second', 2),
    ];
    const { published, targetPath } = await contend(root, 'generic', values);
    assert.equal(verifySignedControlPlaneRecord(published, signingSecret), true);
    atomicWriteSignedControlPlaneRecord(
      targetPath,
      published,
      signingSecret,
      { fixtureOnly: true },
    );
    assert.throws(
      () => atomicWriteSignedControlPlaneRecord(
        targetPath,
        genericControl(published.publisher, 3),
        signingSecret,
        { fixtureOnly: true },
      ),
      /different bytes|entry is unsafe/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generic control publication authenticates exact HMAC bytes before create or adopt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-generic-publish-auth-'));
  try {
    const targetPath = path.join(root, 'control.json');
    const tampered = genericControl('tampered', 1);
    tampered.value = 2;
    assert.equal(verifySignedControlPlaneRecord(tampered, signingSecret), false);
    assert.throws(
      () => atomicWriteSignedControlPlaneRecord(
        targetPath,
        tampered,
        signingSecret,
        { fixtureOnly: true },
      ),
      /unauthenticated output/,
    );
    assert.equal(fs.existsSync(targetPath), false);

    const valid = genericControl('valid', 3);
    atomicWriteSignedControlPlaneRecord(
      targetPath,
      valid,
      signingSecret,
      { fixtureOnly: true },
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), valid);
    assert.throws(
      () => atomicWriteSignedControlPlaneRecord(
        targetPath,
        tampered,
        signingSecret,
        { fixtureOnly: true },
      ),
      /unauthenticated output/,
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), valid);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('campaign report publication rejects signed summary-only shape and gate substitutions', () => {
  const mutations = [
    ['extra-field', (report) => { report.summaryOnlyAuthority = true; }],
    ['missing-bundle-digest', (report) => { delete report.verificationBundleSha256; }],
    ['malformed-bundle-digest', (report) => { report.verificationBundleSha256 = 'not-a-digest'; }],
    ['missing-layer', (report) => { delete report.layers.retention; }],
    ['gate-relation', (report) => { report.mechanicalGatesSatisfied = true; }],
    ['claim-boundary', (report) => { report.claimTruth = 'signed summary says qualified'; }],
    ['noncanonical-time', (report) => { report.evaluatedAt = '2026-07-30 00:00:00Z'; }],
    ['partial-harvest-binding', (report) => {
      report.qualificationHarvestBinding = {
        planDigest: 'a'.repeat(64),
      };
    }],
  ];
  for (const [label, mutate] of mutations) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-campaign-report-shape-${label}-`,
    ));
    try {
      const report = campaignReport(label);
      mutate(report);
      const signedMutation = resignReport(report);
      assert.equal(
        verifySignedControlPlaneRecord(signedMutation, signingSecret),
        true,
        label,
      );
      assert.equal(
        verifyPhdCampaignReport(signedMutation, signingSecret),
        false,
        label,
      );
      const targetPath = path.join(root, 'campaign.json');
      assert.throws(
        () => atomicWritePhdCampaignReport(
          targetPath,
          signedMutation,
          signingSecret,
        ),
        /invalid campaign report/,
        label,
      );
      assert.equal(fs.existsSync(targetPath), false, label);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('qualified campaign publication cannot consume only a structurally valid summary HMAC', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-campaign-qualified-summary-only-',
  ));
  try {
    const report = summaryOnlyQualifiedReport();
    assert.equal(verifyPhdCampaignReport(report, signingSecret), true);
    const targetPath = path.join(root, 'campaign.json');
    assert.throws(
      () => atomicWritePhdCampaignReport(
        targetPath,
        report,
        signingSecret,
      ),
      /requires complete underlying campaign verification/,
    );
    assert.equal(fs.existsSync(targetPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generic and campaign outputs cannot occupy or poison the crash-stage prefix', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const reservedName of [
      `.${mode}.json.publish-${'a'.repeat(32)}.tmp`,
      `.${mode}.json.publish-not-a-stage.tmp`,
      `.${mode}.json.publish-attacker-controlled-output`,
      `.${mode}.json.root-publish-${'b'.repeat(32)}.tmp`,
      `.${mode}.json.root-publish-not-a-stage.tmp`,
      '.authenticated-objects',
      '.authenticated-quarantine',
    ]) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-reserved-stage-target-`,
      ));
      try {
        const targetPath = path.join(root, reservedName);
        const value = mode === 'generic'
          ? genericControl(`reserved-stage-target-${reservedName}`)
          : campaignReport(`reserved-stage-target-${reservedName}`);
        assert.throws(
          () => publish(mode, targetPath, value),
          /reserved authority namespace/,
        );
        assert.equal(fs.existsSync(targetPath), false, `${mode}:${reservedName}`);
        assert.deepEqual(fs.readdirSync(root), [], `${mode}:${reservedName}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('generic and campaign publication reject control characters in durable target names', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const controlCharacter of ['\n', '\r', '\t', '\x7f']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-control-character-target-`,
      ));
      try {
        const targetPath = path.join(
          root,
          `${mode}${controlCharacter}output.json`,
        );
        const value = mode === 'generic'
          ? genericControl('control-character-target')
          : campaignReport('control-character-target');
        assert.throws(
          () => publish(mode, targetPath, value),
          /target name contains a control character/,
        );
        assert.equal(fs.existsSync(targetPath), false);
        assert.deepEqual(fs.readdirSync(root), []);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('distinct authenticated campaign reports cannot replace the first result', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-campaign-publish-race-'));
  try {
    const reports = [campaignReport('first'), campaignReport('second')];
    assert.equal(reports.every((report) => (
      verifyPhdCampaignReport(report, signingSecret)
    )), true);
    const { published, targetPath } = await contend(root, 'campaign', reports);
    assert.equal(verifyPhdCampaignReport(published, signingSecret), true);
    atomicWritePhdCampaignReport(
      targetPath,
      published,
      signingSecret,
      { fixtureOnly: true },
    );
    const other = reports.find((report) => (
      canonicalJson(report) !== canonicalJson(published)
    ));
    assert.throws(
      () => atomicWritePhdCampaignReport(
        targetPath,
        other,
        signingSecret,
        { fixtureOnly: true },
      ),
      /different bytes|entry is unsafe/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('byte-identical competing publishers both adopt one authenticated inode', async () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-identical-race-`,
    ));
    try {
      const value = mode === 'generic'
        ? genericControl('identical')
        : campaignReport('identical');
      const { published, targetPath } = await contend(
        root,
        mode,
        [value, value],
        [0, 0],
      );
      assert.deepEqual(published, value);
      assert.equal(fs.statSync(targetPath).nlink, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('an identical publisher adopts a winner that unlinks its already-open stage', () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-open-stage-cleanup-race-`,
    ));
    const originalOpenSync = fs.openSync;
    try {
      const targetPath = path.join(root, `${mode}.json`);
      const value = mode === 'generic'
        ? genericControl('open-stage-cleanup-race')
        : campaignReport('open-stage-cleanup-race');
      const stageFragment = `/.${mode}.json.publish-`;
      let interleaved = false;
      fs.openSync = function interleaveStageCleanup(target, flags, ...rest) {
        const descriptor = originalOpenSync.call(fs, target, flags, ...rest);
        if (!interleaved
            && typeof target === 'string'
            && target.includes(stageFragment)
            && (flags & fs.constants.O_ACCMODE) === fs.constants.O_RDONLY) {
          interleaved = true;
          try {
            publish(mode, targetPath, value);
          } catch (error) {
            fs.closeSync(descriptor);
            throw error;
          }
        }
        return descriptor;
      };
      publish(mode, targetPath, value);
      assert.equal(interleaved, true, mode);
      assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
      assert.equal(fs.statSync(targetPath).nlink, 1);
      assert.equal(
        fs.readdirSync(root).some((name) => name.includes('.publish-')),
        false,
      );
    } finally {
      fs.openSync = originalOpenSync;
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('generic control publication reconciles every durable hard-link crash cut', () => {
  for (const phase of [
    'after_stage_create',
    'after_stage_file_fsync',
    'after_stage_fsync',
    'after_prelink_stage_fsync',
    'after_target_link',
    'after_target_file_fsync',
    'after_target_link_fsync',
    'after_stage_unlink',
    'after_stage_unlink_fsync',
    'before_publish_named_target_revalidation',
    'before_publish_final_named_target_revalidation',
    'before_publish_final_named_target_revalidation_pinned',
    'before_publish_final_named_target_revalidation_before_commit_witness',
    'before_publish_final_named_target_revalidation_after_commit_witness_fsync',
    'after_publish_pinned_descriptor_release_before_return_witness',
    'after_publish_return_witness_descriptor_release_before_confirmation',
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `clos-generic-cut-${phase}-`));
    try {
      const targetPath = path.join(root, 'control.json');
      const record = genericControl(`crash-${phase}`);
      assert.throws(() => atomicWriteSignedControlPlaneRecord(
        targetPath,
        record,
        signingSecret,
        {
          fixtureOnly: true,
          crashInjector(observed) {
            if (observed === phase) throw new Error(`crash:${phase}`);
          },
        },
      ), new RegExp(`crash:${phase}`));
      atomicWriteSignedControlPlaneRecord(
        targetPath,
        record,
        signingSecret,
        { fixtureOnly: true },
      );
      assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), record);
      assert.equal(fs.statSync(targetPath).nlink, 1);
      assert.equal(
        fs.readdirSync(root).some((name) => name.includes('.publish-')),
        false,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('campaign report publication authenticates and reconciles every crash cut', () => {
  for (const phase of [
    'after_stage_create',
    'after_stage_file_fsync',
    'after_stage_fsync',
    'after_prelink_stage_fsync',
    'after_target_link',
    'after_target_file_fsync',
    'after_target_link_fsync',
    'after_stage_unlink',
    'after_stage_unlink_fsync',
    'before_publish_named_target_revalidation',
    'before_publish_final_named_target_revalidation',
    'before_publish_final_named_target_revalidation_pinned',
    'before_publish_final_named_target_revalidation_before_commit_witness',
    'before_publish_final_named_target_revalidation_after_commit_witness_fsync',
    'after_publish_pinned_descriptor_release_before_return_witness',
    'after_publish_return_witness_descriptor_release_before_confirmation',
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `clos-campaign-cut-${phase}-`));
    try {
      const targetPath = path.join(root, 'campaign.json');
      const report = campaignReport(phase);
      assert.throws(() => atomicWritePhdCampaignReport(
        targetPath,
        report,
        signingSecret,
        {
          fixtureOnly: true,
          crashInjector(observed) {
            if (observed === phase) throw new Error(`crash:${phase}`);
          },
        },
      ), new RegExp(`crash:${phase}`));
      atomicWritePhdCampaignReport(
        targetPath,
        report,
        signingSecret,
        { fixtureOnly: true },
      );
      const published = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      assert.equal(verifyPhdCampaignReport(published, signingSecret), true);
      assert.deepEqual(published, report);
      assert.equal(fs.statSync(targetPath).nlink, 1);
      assert.equal(
        fs.readdirSync(root).some((name) => name.includes('.publish-')),
        false,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('generic and campaign publication recover after real process death at fsync cuts', async () => {
  for (const mode of ['generic', 'campaign']) {
    for (const crashPhase of [
      'after_stage_file_fsync',
      'after_prelink_stage_fsync',
      'after_target_file_fsync',
      'before_publish_named_target_revalidation',
      'before_publish_final_named_target_revalidation',
      'before_publish_final_named_target_revalidation_pinned',
      'before_publish_final_named_target_revalidation_before_commit_witness',
      'before_publish_final_named_target_revalidation_after_commit_witness_fsync',
      'after_publish_pinned_descriptor_release_before_return_witness',
      'after_publish_return_witness_descriptor_release_before_confirmation',
    ]) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-sigkill-${crashPhase}-`,
      ));
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const readyPath = path.join(root, 'child.ready');
        const startPath = path.join(root, 'child.start');
        const inputPath = path.join(root, 'child.input.json');
        const value = mode === 'generic'
          ? genericControl(`sigkill-${crashPhase}`)
          : campaignReport(`sigkill-${crashPhase}`);
        fs.writeFileSync(inputPath, `${JSON.stringify({
          mode,
          targetPath,
          readyPath,
          startPath,
          crashPhase,
          ...(mode === 'generic'
            ? { record: value, signingSecret }
            : { report: value, signingSecret }),
        }, null, 2)}\n`, { mode: 0o600 });
        const child = runChild(inputPath);
        waitForPath(readyPath);
        fs.writeFileSync(startPath, 'start\n', { flag: 'wx', mode: 0o600 });
        const result = await child.completed;
        assert.equal(result.code, null, result.stderr);
        assert.equal(result.signal, 'SIGKILL', result.stderr);

        publish(mode, targetPath, value);
        assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
        assert.equal(fs.statSync(targetPath).nlink, 1);
        assert.equal(
          fs.readdirSync(root).some((name) => name.includes('.publish-')),
          false,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('generic and campaign re-sync an adopted crash stage before no-replace commit', () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-adopted-stage-durability-`,
    ));
    const originalFsyncSync = fs.fsyncSync;
    const originalLinkSync = fs.linkSync;
    try {
      const targetPath = path.join(root, `${mode}.json`);
      const value = mode === 'generic'
        ? genericControl('adopted-stage-durability')
        : campaignReport('adopted-stage-durability');
      const expectedBytes = Buffer.from(
        `${JSON.stringify(value, null, 2)}\n`,
        'utf8',
      );
      const stagePath = path.join(
        root,
        `.${mode}.json.publish-${'a'.repeat(32)}.tmp`,
      );
      fs.writeFileSync(stagePath, expectedBytes, { mode: 0o600 });
      const stage = fs.statSync(stagePath, { bigint: true });
      const parent = fs.statSync(root, { bigint: true });
      const barriers = [];
      let commitObserved = false;
      fs.fsyncSync = function recordPrelinkBarrier(descriptor) {
        const stat = fs.fstatSync(descriptor, { bigint: true });
        if (stat.dev === stage.dev && stat.ino === stage.ino) {
          barriers.push('stage');
        } else if (stat.dev === parent.dev && stat.ino === parent.ino) {
          barriers.push('parent');
        }
        return originalFsyncSync.call(fs, descriptor);
      };
      fs.linkSync = function requirePrelinkBarrier(source, target) {
        if (String(target).endsWith(`/${mode}.json`)) {
          assert.deepEqual(barriers.slice(-2), ['stage', 'parent']);
          commitObserved = true;
        }
        return originalLinkSync.call(fs, source, target);
      };

      publish(mode, targetPath, value);
      assert.equal(commitObserved, true, mode);
      assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
      assert.equal(fs.statSync(targetPath).nlink, 1);
      assert.equal(fs.existsSync(stagePath), false);
    } finally {
      fs.fsyncSync = originalFsyncSync;
      fs.linkSync = originalLinkSync;
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('publication reconciles a distinct crashed stage after a durable winner is selected', () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-distinct-stage-cut-`,
    ));
    try {
      const targetPath = path.join(root, `${mode}.json`);
      const abandoned = mode === 'generic'
        ? genericControl('abandoned')
        : campaignReport('abandoned');
      const winner = mode === 'generic'
        ? genericControl('winner')
        : campaignReport('winner');
      assert.throws(() => publish(mode, targetPath, abandoned, {
        crashInjector(phase) {
          if (phase === 'after_stage_fsync') throw new Error('crash:abandoned-stage');
        },
      }), /crash:abandoned-stage/);
      assert.equal(fs.existsSync(targetPath), false);
      assert.equal(
        fs.readdirSync(root).filter((name) => name.includes('.publish-')).length,
        1,
      );

      publish(mode, targetPath, winner);
      assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), winner);
      assert.equal(fs.statSync(targetPath).nlink, 1);
      assert.equal(
        fs.readdirSync(root).some((name) => name.includes('.publish-')),
        false,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a losing publisher durably reconciles its late crash stage before rejecting the winner', () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-late-loser-stage-`,
    ));
    try {
      const targetPath = path.join(root, `${mode}.json`);
      const loser = mode === 'generic'
        ? genericControl('late-loser')
        : campaignReport('late-loser');
      const winner = mode === 'generic'
        ? genericControl('selected-winner')
        : campaignReport('selected-winner');
      let winnerPublished = false;
      assert.throws(() => publish(mode, targetPath, loser, {
        crashInjector(phase) {
          if (phase === 'after_initial_target_absence' && !winnerPublished) {
            winnerPublished = true;
            publish(mode, targetPath, winner);
          } else if (phase === 'after_stage_fsync') {
            throw new Error('crash:late-loser-stage');
          }
        },
      }), /crash:late-loser-stage/);
      assert.equal(winnerPublished, true);
      assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), winner);
      assert.equal(
        fs.readdirSync(root).filter((name) => name.includes('.publish-')).length,
        1,
      );

      assert.throws(
        () => publish(mode, targetPath, loser),
        /different bytes/,
      );
      assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), winner);
      assert.equal(fs.statSync(targetPath).nlink, 1);
      assert.equal(
        fs.readdirSync(root).some((name) => name.includes('.publish-')),
        false,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('publication retries reconcile both authenticated adoption crash boundaries', () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-adoption-cuts-`,
    ));
    try {
      const targetPath = path.join(root, `${mode}.json`);
      const value = mode === 'generic'
        ? genericControl('adopted')
        : campaignReport('adopted');
      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase === 'after_target_link') throw new Error('crash:linked');
        },
      }), /crash:linked/);
      assert.equal(fs.statSync(targetPath).nlink, 2);

      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase === 'after_adopt_fsync') throw new Error('crash:adopt-fsync');
        },
      }), /crash:adopt-fsync/);
      assert.equal(fs.statSync(targetPath).nlink, 2);

      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase === 'after_adopt_cleanup_fsync') {
            throw new Error('crash:adopt-cleanup');
          }
        },
      }), /crash:adopt-cleanup/);
      assert.equal(fs.statSync(targetPath).nlink, 1);

      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase === 'before_adopt_final_revalidation') {
            throw new Error('crash:adopt-final-revalidation');
          }
        },
      }), /crash:adopt-final-revalidation/);
      assert.equal(fs.statSync(targetPath).nlink, 1);

      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase === 'before_adopt_named_target_revalidation') {
            throw new Error('crash:adopt-named-target-revalidation');
          }
        },
      }), /crash:adopt-named-target-revalidation/);
      assert.equal(fs.statSync(targetPath).nlink, 1);

      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase === 'before_adopt_final_named_target_revalidation') {
            throw new Error('crash:adopt-final-named-target-revalidation');
          }
        },
      }), /crash:adopt-final-named-target-revalidation/);
      assert.equal(fs.statSync(targetPath).nlink, 1);

      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase === 'before_adopt_final_named_target_revalidation_pinned') {
            throw new Error('crash:adopt-final-pinned-target-revalidation');
          }
        },
      }), /crash:adopt-final-pinned-target-revalidation/);
      assert.equal(fs.statSync(targetPath).nlink, 1);

      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase
              === 'before_adopt_final_named_target_revalidation_before_commit_witness') {
            throw new Error('crash:adopt-commit-witness');
          }
        },
      }), /crash:adopt-commit-witness/);
      assert.equal(fs.statSync(targetPath).nlink, 1);

      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase
              === 'before_adopt_final_named_target_revalidation_after_commit_witness_fsync') {
            throw new Error('crash:adopt-post-commit-fsync');
          }
        },
      }), /crash:adopt-post-commit-fsync/);
      assert.equal(fs.statSync(targetPath).nlink, 1);

      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase
              === 'after_adopt_pinned_descriptor_release_before_return_witness') {
            throw new Error('crash:adopt-post-release-witness');
          }
        },
      }), /crash:adopt-post-release-witness/);
      assert.equal(fs.statSync(targetPath).nlink, 1);

      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase
              === 'after_adopt_return_witness_descriptor_release_before_confirmation') {
            throw new Error('crash:adopt-descriptor-free-confirmation');
          }
        },
      }), /crash:adopt-descriptor-free-confirmation/);
      assert.equal(fs.statSync(targetPath).nlink, 1);

      publish(mode, targetPath, value);
      assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
      assert.equal(
        fs.readdirSync(root).some((name) => name.includes('.publish-')),
        false,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('generic and campaign adoption reject same-inode change-and-restore races', () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-adoption-ctime-aba-`,
    ));
    try {
      const targetPath = path.join(root, `${mode}.json`);
      const value = mode === 'generic'
        ? genericControl('adoption-ctime-aba')
        : campaignReport('adoption-ctime-aba');
      publish(mode, targetPath, value);
      const pinnedTimestamp = new Date('2026-07-29T12:00:00.000Z');
      fs.utimesSync(targetPath, pinnedTimestamp, pinnedTimestamp);
      const expectedBytes = fs.readFileSync(targetPath);
      const before = fs.statSync(targetPath, { bigint: true });
      let mutated = false;
      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase !== 'before_adopt_final_revalidation' || mutated) return;
          mutated = true;
          fs.writeFileSync(targetPath, expectedBytes);
          fs.utimesSync(targetPath, pinnedTimestamp, pinnedTimestamp);
          const restored = fs.statSync(targetPath, { bigint: true });
          assert.equal(restored.dev, before.dev);
          assert.equal(restored.ino, before.ino);
          assert.equal(restored.nlink, before.nlink);
          assert.equal(restored.size, before.size);
          assert.equal(restored.mtimeNs, before.mtimeNs);
          assert.equal(restored.birthtimeNs, before.birthtimeNs);
          assert.notEqual(restored.ctimeNs, before.ctimeNs);
        },
      }), /target inode changed during adoption/, mode);
      assert.equal(mutated, true, mode);
      assert.deepEqual(fs.readFileSync(targetPath), expectedBytes, mode);
      publish(mode, targetPath, value);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('generic and campaign publication fsync the selected inode after alias removal', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const boundary of ['publisher', 'adopter']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-${boundary}-final-link-fsync-`,
      ));
      const originalFsyncSync = fs.fsyncSync;
      const fsyncs = [];
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const value = mode === 'generic'
          ? genericControl(`${boundary}-final-link-fsync`)
          : campaignReport(`${boundary}-final-link-fsync`);
        if (boundary === 'adopter') {
          assert.throws(() => publish(mode, targetPath, value, {
            crashInjector(phase) {
              if (phase === 'after_target_link') {
                throw new Error('crash:leave-publication-alias');
              }
            },
          }), /crash:leave-publication-alias/);
          assert.equal(fs.statSync(targetPath).nlink, 2);
        }
        fs.fsyncSync = function recordPublicationFsync(descriptor) {
          const stat = fs.fstatSync(descriptor, { bigint: true });
          fsyncs.push({
            dev: stat.dev,
            ino: stat.ino,
            isDirectory: stat.isDirectory(),
            nlink: stat.nlink,
          });
          return originalFsyncSync.call(fs, descriptor);
        };
        const crashPhase = boundary === 'publisher'
          ? 'after_stage_unlink_fsync'
          : 'after_adopt_cleanup_fsync';
        assert.throws(() => publish(mode, targetPath, value, {
          crashInjector(phase) {
            if (phase !== crashPhase) return;
            const target = fs.statSync(targetPath, { bigint: true });
            const parent = fs.statSync(root, { bigint: true });
            assert.deepEqual(fsyncs.slice(-2), [
              {
                dev: target.dev,
                ino: target.ino,
                isDirectory: false,
                nlink: 1n,
              },
              {
                dev: parent.dev,
                ino: parent.ino,
                isDirectory: true,
                nlink: parent.nlink,
              },
            ]);
            throw new Error(`crash:${crashPhase}`);
          },
        }), new RegExp(`crash:${crashPhase}`));
        assert.equal(fs.statSync(targetPath).nlink, 1);
        fs.fsyncSync = originalFsyncSync;
        publish(mode, targetPath, value);
        assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
        assert.equal(fs.statSync(targetPath).nlink, 1);
      } finally {
        fs.fsyncSync = originalFsyncSync;
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('an identical adopter may finish a pinned winner without making the winner fail', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const adoptionPhase of ['after_stage_fsync', 'after_target_link']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-interleaved-adoption-${adoptionPhase}-`,
      ));
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const value = mode === 'generic'
          ? genericControl(adoptionPhase)
          : campaignReport(adoptionPhase);
        let adopted = false;
        publish(mode, targetPath, value, {
          crashInjector(phase) {
            if (phase !== adoptionPhase || adopted) return;
            adopted = true;
            publish(mode, targetPath, value);
          },
        });
        assert.equal(adopted, true);
        assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
        assert.equal(fs.statSync(targetPath).nlink, 1);
        assert.equal(
          fs.readdirSync(root).some((name) => name.includes('.publish-')),
          false,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('identical adoption retries when winner cleanup changes the pinned link snapshot', () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-adoption-snapshot-retry-`,
    ));
    try {
      const targetPath = path.join(root, `${mode}.json`);
      const value = mode === 'generic'
        ? genericControl('adoption-snapshot-retry')
        : campaignReport('adoption-snapshot-retry');
      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase === 'after_target_link') {
            throw new Error('crash:linked-winner');
          }
        },
      }), /crash:linked-winner/);
      assert.equal(fs.statSync(targetPath).nlink, 2);

      let cleanupInterleaved = false;
      publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase !== 'after_adopt_target_open' || cleanupInterleaved) return;
          cleanupInterleaved = true;
          publish(mode, targetPath, value);
          assert.equal(fs.statSync(targetPath).nlink, 1);
        },
      });
      assert.equal(cleanupInterleaved, true);
      assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
      assert.equal(fs.statSync(targetPath).nlink, 1);
      assert.equal(
        fs.readdirSync(root).some((name) => name.includes('.publish-')),
        false,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('identical adoption reconciles a staging alias linked after its snapshot', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const phase of [
      'after_adopt_fsync',
      'before_adopt_final_revalidation',
    ]) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-late-adoption-alias-${phase}-`,
      ));
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const value = mode === 'generic'
          ? genericControl(`late-adoption-alias-${phase}`)
          : campaignReport(`late-adoption-alias-${phase}`);
        publish(mode, targetPath, value);
        let aliasLinked = false;
        publish(mode, targetPath, value, {
          crashInjector(observedPhase) {
            if (observedPhase !== phase || aliasLinked) return;
            aliasLinked = true;
            fs.linkSync(
              targetPath,
              path.join(
                root,
                `.${mode}.json.publish-${'b'.repeat(32)}.tmp`,
              ),
            );
            assert.equal(fs.statSync(targetPath).nlink, 2);
          },
        });
        assert.equal(aliasLinked, true, `${mode}:${phase}`);
        assert.deepEqual(
          JSON.parse(fs.readFileSync(targetPath, 'utf8')),
          value,
        );
        assert.equal(fs.statSync(targetPath).nlink, 1);
        assert.equal(
          fs.readdirSync(root).some((name) => name.includes('.publish-')),
          false,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('late unknown adoption hard links remain fail-closed', () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-late-unknown-adoption-link-`,
    ));
    try {
      const targetPath = path.join(root, `${mode}.json`);
      const aliasPath = path.join(root, `${mode}.unknown-alias.json`);
      const value = mode === 'generic'
        ? genericControl('late-unknown-adoption-link')
        : campaignReport('late-unknown-adoption-link');
      publish(mode, targetPath, value);
      let aliasLinked = false;
      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase !== 'after_adopt_fsync' || aliasLinked) return;
          aliasLinked = true;
          fs.linkSync(targetPath, aliasPath);
        },
      }), /unknown hard link/);
      assert.equal(aliasLinked, true, mode);
      assert.equal(fs.statSync(targetPath).nlink, 2);
      assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
      fs.unlinkSync(aliasPath);
      publish(mode, targetPath, value);
      assert.equal(fs.statSync(targetPath).nlink, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a publisher adopts an identical target linked after its initial absence check', () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-late-identical-link-`,
    ));
    try {
      const targetPath = path.join(root, `${mode}.json`);
      const value = mode === 'generic'
        ? genericControl('late-link')
        : campaignReport('late-link');
      let linkedByCompetitor = false;
      publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase !== 'after_stage_fsync' || linkedByCompetitor) return;
          linkedByCompetitor = true;
          assert.throws(() => publish(mode, targetPath, value, {
            crashInjector(innerPhase) {
              if (innerPhase === 'after_target_link') {
                throw new Error('crash:competitor-linked');
              }
            },
          }), /crash:competitor-linked/);
          assert.equal(fs.statSync(targetPath).nlink, 2);
        },
      });
      assert.equal(linkedByCompetitor, true);
      assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
      assert.equal(fs.statSync(targetPath).nlink, 1);
      assert.equal(
        fs.readdirSync(root).some((name) => name.includes('.publish-')),
        false,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('publication revalidates its staged inode immediately before the no-replace link', () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-staging-inode-swap-`,
    ));
    try {
      const targetPath = path.join(root, `${mode}.json`);
      const value = mode === 'generic'
        ? genericControl('staging-inode-swap')
        : campaignReport('staging-inode-swap');
      let replaced = false;
      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase !== 'before_target_link_revalidation' || replaced) return;
          const stagingName = fs.readdirSync(root).find((name) => (
            name.startsWith(`.${mode}.json.publish-`)
          ));
          assert.equal(typeof stagingName, 'string');
          const stagingPath = path.join(root, stagingName);
          const exactBytes = fs.readFileSync(stagingPath);
          fs.unlinkSync(stagingPath);
          fs.writeFileSync(stagingPath, exactBytes, { mode: 0o600 });
          replaced = true;
        },
      }), /staging identity changed before no-replace link/);
      assert.equal(replaced, true);
      assert.equal(fs.existsSync(targetPath), false);
      assert.equal(
        fs.readdirSync(root).some((name) => name.includes('.publish-')),
        false,
      );

      publish(mode, targetPath, value);
      assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
      assert.equal(fs.statSync(targetPath).nlink, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('publication binds nanosecond staging metadata before the no-replace link', () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-staging-nanosecond-rewrite-`,
    ));
    try {
      const targetPath = path.join(root, `${mode}.json`);
      const value = mode === 'generic'
        ? genericControl('staging-nanosecond-rewrite')
        : campaignReport('staging-nanosecond-rewrite');
      let rewritten = false;
      assert.throws(() => publish(mode, targetPath, value, {
        crashInjector(phase) {
          if (phase !== 'before_target_link_revalidation' || rewritten) return;
          const stagingName = fs.readdirSync(root).find((name) => (
            name.startsWith(`.${mode}.json.publish-`)
          ));
          assert.equal(typeof stagingName, 'string');
          const stagingPath = path.join(root, stagingName);
          const exactBytes = fs.readFileSync(stagingPath);
          const before = fs.statSync(stagingPath, { bigint: true });
          fs.writeFileSync(stagingPath, exactBytes);
          const restored = spawnSync('python3', [
            '-c',
            'import os,sys; os.utime(sys.argv[1], ns=(int(sys.argv[2]), int(sys.argv[3])))',
            stagingPath,
            before.atimeNs.toString(),
            before.mtimeNs.toString(),
          ], { encoding: 'utf8' });
          assert.equal(restored.status, 0, restored.stderr);
          const after = fs.statSync(stagingPath, { bigint: true });
          assert.equal(after.ino, before.ino);
          assert.equal(after.mtimeNs, before.mtimeNs);
          assert.notEqual(after.ctimeNs, before.ctimeNs);
          rewritten = true;
        },
      }), /staging identity changed before no-replace link/);
      assert.equal(rewritten, true);
      assert.equal(fs.existsSync(targetPath), false);
      assert.equal(
        fs.readdirSync(root).some((name) => name.includes('.publish-')),
        false,
      );

      publish(mode, targetPath, value);
      assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
      assert.equal(fs.statSync(targetPath).nlink, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('publication pins the selected inode through exact-byte final revalidation', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const boundary of ['adoption', 'final']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-${boundary}-exact-inode-swap-`,
      ));
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const value = mode === 'generic'
          ? genericControl(`${boundary}-exact-inode-swap`)
          : campaignReport(`${boundary}-exact-inode-swap`);
        if (boundary === 'adoption') {
          assert.throws(() => publish(mode, targetPath, value, {
            crashInjector(phase) {
              if (phase === 'after_target_link') {
                throw new Error('crash:linked-for-adoption');
              }
            },
          }), /crash:linked-for-adoption/);
          assert.equal(fs.statSync(targetPath).nlink, 2);
        }

        let substituted = false;
        assert.throws(() => publish(mode, targetPath, value, {
          crashInjector(phase) {
            const targetPhase = boundary === 'adoption'
              ? 'before_adopt_final_revalidation'
              : 'after_stage_unlink_fsync';
            if (phase !== targetPhase || substituted) return;
            const selected = fs.statSync(targetPath);
            const selectedExact = fs.statSync(targetPath, { bigint: true });
            const selectedInodeIsPinned = fs.readdirSync('/proc/self/fd').some((name) => {
              try {
                const opened = fs.fstatSync(Number(name));
                return opened.dev === selected.dev && opened.ino === selected.ino;
              } catch {
                return false;
              }
            });
            assert.equal(selectedInodeIsPinned, true);
            const exactBytes = fs.readFileSync(targetPath);
            fs.unlinkSync(targetPath);
            fs.writeFileSync(targetPath, exactBytes, { mode: 0o600 });
            const restored = spawnSync('python3', [
              '-c',
              'import os,sys; os.utime(sys.argv[1], ns=(int(sys.argv[2]), int(sys.argv[3])))',
              targetPath,
              selectedExact.atimeNs.toString(),
              selectedExact.mtimeNs.toString(),
            ], { encoding: 'utf8' });
            assert.equal(restored.status, 0, restored.stderr);
            const replacement = fs.statSync(targetPath);
            const replacementExact = fs.statSync(targetPath, { bigint: true });
            assert.equal(replacement.mode & 0o7777, selected.mode & 0o7777);
            assert.equal(replacement.size, selected.size);
            assert.equal(replacement.mtimeMs, selected.mtimeMs);
            assert.equal(replacementExact.mtimeNs, selectedExact.mtimeNs);
            assert.notEqual(
              `${replacement.dev}:${replacement.ino}`,
              `${selected.dev}:${selected.ino}`,
            );
            substituted = true;
          },
        }), /target inode changed/);
        assert.equal(substituted, true);
        assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
        assert.equal(fs.statSync(targetPath).nlink, 1);
        assert.equal(
          fs.readdirSync(root).some((name) => name.includes('.publish-')),
          false,
        );

        publish(mode, targetPath, value);
        assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
        assert.equal(fs.statSync(targetPath).nlink, 1);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('publication reopens the selected name after validating its parent', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const boundary of ['publisher', 'adopter']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-${boundary}-post-parent-name-swap-`,
      ));
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const value = mode === 'generic'
          ? genericControl(`${boundary}-post-parent-name-swap`)
          : campaignReport(`${boundary}-post-parent-name-swap`);
        if (boundary === 'adopter') publish(mode, targetPath, value);
        let substituted = false;
        assert.throws(() => publish(mode, targetPath, value, {
          crashInjector(phase) {
            const targetPhase = boundary === 'publisher'
              ? 'before_publish_named_target_revalidation'
              : 'before_adopt_named_target_revalidation';
            if (phase !== targetPhase || substituted) return;
            const selected = fs.statSync(targetPath);
            const selectedIsPinned = fs.readdirSync('/proc/self/fd').some((name) => {
              try {
                const opened = fs.fstatSync(Number(name));
                return opened.dev === selected.dev && opened.ino === selected.ino;
              } catch {
                return false;
              }
            });
            assert.equal(selectedIsPinned, true);
            const exactBytes = fs.readFileSync(targetPath);
            fs.unlinkSync(targetPath);
            fs.writeFileSync(targetPath, exactBytes, { mode: 0o600 });
            const replacement = fs.statSync(targetPath);
            assert.notEqual(
              `${replacement.dev}:${replacement.ino}`,
              `${selected.dev}:${selected.ino}`,
            );
            substituted = true;
          },
        }), /target changed after .* parent revalidation/);
        assert.equal(substituted, true);
        assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
        assert.equal(fs.statSync(targetPath).nlink, 1);
        assert.equal(
          fs.readdirSync(root).some((name) => name.includes('.publish-')),
          false,
        );

        publish(mode, targetPath, value);
        assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
        assert.equal(fs.statSync(targetPath).nlink, 1);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('publication resolves the selected target through its final named-parent descriptor', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const boundary of ['publisher', 'adopter']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-${boundary}-final-named-parent-target-`,
      ));
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const value = mode === 'generic'
          ? genericControl(`${boundary}-final-named-parent-target`)
          : campaignReport(`${boundary}-final-named-parent-target`);
        if (boundary === 'adopter') publish(mode, targetPath, value);
        const attackPhase = boundary === 'publisher'
          ? 'before_publish_final_named_target_revalidation'
          : 'before_adopt_final_named_target_revalidation';
        let substituted = false;
        assert.throws(() => publish(mode, targetPath, value, {
          crashInjector(phase) {
            if (phase !== attackPhase || substituted) return;
            const selected = fs.statSync(targetPath, { bigint: true });
            const exactBytes = fs.readFileSync(targetPath);
            fs.unlinkSync(targetPath);
            fs.writeFileSync(targetPath, exactBytes, { mode: 0o600 });
            const replacement = fs.statSync(targetPath, { bigint: true });
            assert.notEqual(
              `${replacement.dev}:${replacement.ino}`,
              `${selected.dev}:${selected.ino}`,
            );
            substituted = true;
          },
        }), /changed during final named-parent/);
        assert.equal(substituted, true, `${mode}:${boundary}`);
        assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
        assert.equal(fs.statSync(targetPath).nlink, 1);
        assert.equal(
          fs.readdirSync(root).some((name) => name.includes('.publish-')),
          false,
        );

        publish(mode, targetPath, value);
        assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
        assert.equal(fs.statSync(targetPath).nlink, 1);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('publication revalidates the named parent after its final target operation', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const boundary of ['publisher', 'adopter']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-${boundary}-final-named-parent-swap-`,
      ));
      const displaced = `${root}.displaced`;
      let activeRoot = root;
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const value = mode === 'generic'
          ? genericControl(`${boundary}-final-named-parent-swap`)
          : campaignReport(`${boundary}-final-named-parent-swap`);
        if (boundary === 'adopter') publish(mode, targetPath, value);
        const attackPhase = boundary === 'publisher'
          ? 'before_publish_final_named_target_revalidation'
          : 'before_adopt_final_named_target_revalidation';
        let substituted = false;
        assert.throws(() => publish(mode, targetPath, value, {
          crashInjector(phase) {
            if (phase !== attackPhase || substituted) return;
            fs.renameSync(root, displaced);
            fs.mkdirSync(root, { mode: 0o700 });
            activeRoot = displaced;
            substituted = true;
          },
        }), /parent identity changed during named-parent operation/);
        assert.equal(substituted, true, `${mode}:${boundary}`);
        assert.deepEqual(fs.readdirSync(root), []);
        assert.deepEqual(
          JSON.parse(fs.readFileSync(path.join(displaced, `${mode}.json`), 'utf8')),
          value,
        );

        fs.rmdirSync(root);
        fs.renameSync(displaced, root);
        activeRoot = root;
        publish(mode, targetPath, value);
        assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
        assert.equal(fs.statSync(targetPath).nlink, 1);
        assert.equal(
          fs.readdirSync(root).some((name) => name.includes('.publish-')),
          false,
        );
      } finally {
        fs.rmSync(activeRoot, { recursive: true, force: true });
        if (activeRoot !== root) {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    }
  }
});

test('publication detects a target-name replacement after its final named read', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const boundary of ['publisher', 'adopter']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-${boundary}-post-final-read-target-swap-`,
      ));
      const replacementPath = `${root}.replacement`;
      const originalCloseSync = fs.closeSync;
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const value = mode === 'generic'
          ? genericControl(`${boundary}-post-final-read-target-swap`)
          : campaignReport(`${boundary}-post-final-read-target-swap`);
        const replacement = mode === 'generic'
          ? genericControl(`${boundary}-post-final-read-replacement`)
          : campaignReport(`${boundary}-post-final-read-replacement`);
        fs.writeFileSync(
          replacementPath,
          `${JSON.stringify(replacement, null, 2)}\n`,
          { flag: 'wx', mode: 0o600 },
        );
        if (boundary === 'adopter') publish(mode, targetPath, value);
        const attackPhase = boundary === 'publisher'
          ? 'before_publish_final_named_target_revalidation'
          : 'before_adopt_final_named_target_revalidation';
        let selectedIdentity = null;
        let substituted = false;
        fs.closeSync = function replaceAfterFinalNamedRead(descriptor) {
          let closesSelectedTarget = false;
          if (selectedIdentity !== null && !substituted) {
            try {
              const observed = fs.fstatSync(descriptor, { bigint: true });
              closesSelectedTarget = observed.isFile()
                && observed.dev === selectedIdentity.dev
                && observed.ino === selectedIdentity.ino;
            } catch {}
          }
          const result = originalCloseSync.call(fs, descriptor);
          if (closesSelectedTarget) {
            substituted = true;
            fs.renameSync(replacementPath, targetPath);
          }
          return result;
        };
        assert.throws(() => publish(mode, targetPath, value, {
          crashInjector(phase) {
            if (phase !== attackPhase || selectedIdentity !== null) return;
            selectedIdentity = fs.statSync(targetPath, { bigint: true });
          },
        }), /parent identity changed during named-parent operation/);
        assert.notEqual(selectedIdentity, null, `${mode}:${boundary}`);
        assert.equal(substituted, true, `${mode}:${boundary}`);
        assert.deepEqual(
          JSON.parse(fs.readFileSync(targetPath, 'utf8')),
          replacement,
          `${mode}:${boundary}`,
        );
        assert.equal(fs.statSync(targetPath).nlink, 1);
      } finally {
        fs.closeSync = originalCloseSync;
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(replacementPath, { force: true });
      }
    }
  }
});

test('publication re-reads the pinned target after the final named descriptor closes', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const boundary of ['publisher', 'adopter']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-${boundary}-final-pinned-in-place-rewrite-`,
      ));
      const originalCloseSync = fs.closeSync;
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const value = mode === 'generic'
          ? genericControl(`${boundary}-final-pinned-selected`)
          : campaignReport(`${boundary}-final-pinned-selected`);
        const replacement = mode === 'generic'
          ? genericControl(`${boundary}-final-pinned-replacement`)
          : campaignReport(`${boundary}-final-pinned-replacement`);
        const replacementBytes = Buffer.from(
          `${JSON.stringify(replacement, null, 2)}\n`,
        );
        if (boundary === 'adopter') publish(mode, targetPath, value);
        const selected = boundary === 'adopter'
          ? fs.statSync(targetPath, { bigint: true })
          : null;
        const attackPhase = boundary === 'publisher'
          ? 'before_publish_final_named_target_revalidation_pinned'
          : 'before_adopt_final_named_target_revalidation_pinned';
        let selectedIdentity = selected;
        let armed = false;
        let rewritten = false;
        let parentBefore = null;
        fs.closeSync = function rewriteAfterFinalNamedDescriptor(descriptor) {
          let closesSelectedTarget = false;
          if (armed && !rewritten && selectedIdentity !== null) {
            try {
              const observed = fs.fstatSync(descriptor, { bigint: true });
              closesSelectedTarget = observed.isFile()
                && observed.dev === selectedIdentity.dev
                && observed.ino === selectedIdentity.ino;
            } catch {}
          }
          const result = originalCloseSync.call(fs, descriptor);
          if (closesSelectedTarget) {
            rewritten = true;
            fs.writeFileSync(targetPath, replacementBytes);
            const changed = fs.statSync(targetPath, { bigint: true });
            assert.equal(changed.dev, selectedIdentity.dev);
            assert.equal(changed.ino, selectedIdentity.ino);
          }
          return result;
        };
        assert.throws(() => publish(mode, targetPath, value, {
          crashInjector(phase) {
            if (phase !== attackPhase || armed) return;
            selectedIdentity = fs.statSync(targetPath, { bigint: true });
            parentBefore = fs.statSync(root, { bigint: true });
            armed = true;
          },
        }), /target changed during final named-parent/);
        fs.closeSync = originalCloseSync;
        assert.equal(armed, true, `${mode}:${boundary}`);
        assert.equal(rewritten, true, `${mode}:${boundary}`);
        const parentAfter = fs.statSync(root, { bigint: true });
        assert.equal(parentAfter.mtimeNs, parentBefore.mtimeNs);
        assert.equal(parentAfter.ctimeNs, parentBefore.ctimeNs);
        assert.deepEqual(
          JSON.parse(fs.readFileSync(targetPath, 'utf8')),
          replacement,
          `${mode}:${boundary}`,
        );
        assert.equal(fs.statSync(targetPath).nlink, 1);
        assert.equal(
          fs.readdirSync(root).some((name) => name.includes('.publish-')),
          false,
        );
      } finally {
        fs.closeSync = originalCloseSync;
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('publication resolves a final commit witness after its pinned snapshot closes', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const boundary of ['publisher', 'adopter']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-${boundary}-post-pinned-commit-witness-`,
      ));
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const selected = mode === 'generic'
          ? genericControl(`${boundary}-commit-selected`)
          : campaignReport(`${boundary}-commit-selected`);
        const replacement = mode === 'generic'
          ? genericControl(`${boundary}-commit-hostile-1`)
          : campaignReport(`${boundary}-commit-hostile-1`);
        const replacementBytes = Buffer.from(
          `${JSON.stringify(replacement, null, 2)}\n`,
        );
        if (boundary === 'adopter') publish(mode, targetPath, selected);
        const attackPhase = boundary === 'publisher'
          ? 'before_publish_final_named_target_revalidation_before_commit_witness'
          : 'before_adopt_final_named_target_revalidation_before_commit_witness';
        let rewritten = false;
        let identityBefore = null;
        let parentBefore = null;
        assert.throws(() => publish(mode, targetPath, selected, {
          crashInjector(phase) {
            if (phase !== attackPhase || rewritten) return;
            rewritten = true;
            identityBefore = fs.statSync(targetPath, { bigint: true });
            parentBefore = fs.statSync(root, { bigint: true });
            fs.writeFileSync(targetPath, replacementBytes);
            const changed = fs.statSync(targetPath, { bigint: true });
            assert.equal(changed.dev, identityBefore.dev);
            assert.equal(changed.ino, identityBefore.ino);
          },
        }), /target changed during final named-parent/);
        assert.equal(rewritten, true, `${mode}:${boundary}`);
        const parentAfter = fs.statSync(root, { bigint: true });
        assert.equal(parentAfter.mtimeNs, parentBefore.mtimeNs);
        assert.equal(parentAfter.ctimeNs, parentBefore.ctimeNs);
        assert.deepEqual(
          JSON.parse(fs.readFileSync(targetPath, 'utf8')),
          replacement,
          `${mode}:${boundary}`,
        );
        assert.equal(fs.statSync(targetPath).nlink, 1);
        assert.equal(
          fs.readdirSync(root).some((name) => name.includes('.publish-')),
          false,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('publication revalidates exact bytes after its final file and parent fsync', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const boundary of ['publisher', 'adopter']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-${boundary}-post-commit-fsync-`,
      ));
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const selected = mode === 'generic'
          ? genericControl(`${boundary}-post-commit-fsync-selected`)
          : campaignReport(`${boundary}-post-commit-fsync-selected`);
        const replacement = mode === 'generic'
          ? genericControl(`${boundary}-post-commit-fsync-replacement`)
          : campaignReport(`${boundary}-post-commit-fsync-replacement`);
        const replacementBytes = Buffer.from(
          `${JSON.stringify(replacement, null, 2)}\n`,
        );
        if (boundary === 'adopter') publish(mode, targetPath, selected);
        const attackPhase = boundary === 'publisher'
          ? 'before_publish_final_named_target_revalidation_after_commit_witness_fsync'
          : 'before_adopt_final_named_target_revalidation_after_commit_witness_fsync';
        let rewritten = false;
        let selectedIdentity = null;
        let parentBefore = null;
        assert.throws(() => publish(mode, targetPath, selected, {
          crashInjector(phase) {
            if (phase !== attackPhase || rewritten) return;
            rewritten = true;
            selectedIdentity = fs.statSync(targetPath, { bigint: true });
            parentBefore = fs.statSync(root, { bigint: true });
            fs.writeFileSync(targetPath, replacementBytes);
            const changed = fs.statSync(targetPath, { bigint: true });
            assert.equal(changed.dev, selectedIdentity.dev);
            assert.equal(changed.ino, selectedIdentity.ino);
          },
        }), /target changed during final named-parent/);
        assert.equal(rewritten, true, `${mode}:${boundary}`);
        const parentAfter = fs.statSync(root, { bigint: true });
        assert.equal(parentAfter.mtimeNs, parentBefore.mtimeNs);
        assert.equal(parentAfter.ctimeNs, parentBefore.ctimeNs);
        assert.deepEqual(
          JSON.parse(fs.readFileSync(targetPath, 'utf8')),
          replacement,
          `${mode}:${boundary}`,
        );
        assert.equal(fs.statSync(targetPath).nlink, 1);
        assert.equal(
          fs.readdirSync(root).some((name) => name.includes('.publish-')),
          false,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('publication resolves the target afresh after every earlier file pin closes', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const boundary of ['publisher', 'adopter']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-${boundary}-post-pin-release-witness-`,
      ));
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const selected = mode === 'generic'
          ? genericControl(`${boundary}-post-pin-release-selected`)
          : campaignReport(`${boundary}-post-pin-release-selected`);
        const replacement = mode === 'generic'
          ? genericControl(`${boundary}-post-pin-release-replacement`)
          : campaignReport(`${boundary}-post-pin-release-replacement`);
        const replacementBytes = Buffer.from(
          `${JSON.stringify(replacement, null, 2)}\n`,
        );
        if (boundary === 'adopter') publish(mode, targetPath, selected);
        const attackPhase = boundary === 'publisher'
          ? 'after_publish_pinned_descriptor_release_before_return_witness'
          : 'after_adopt_pinned_descriptor_release_before_return_witness';
        let replaced = false;
        assert.throws(() => publish(mode, targetPath, selected, {
          crashInjector(phase) {
            if (phase !== attackPhase || replaced) return;
            const selectedIdentity = fs.statSync(targetPath, { bigint: true });
            const selectedKey = `${selectedIdentity.dev}:${selectedIdentity.ino}`;
            const openIdentities = new Set(
              fs.readdirSync('/proc/self/fd').flatMap((entry) => {
                try {
                  const stat = fs.fstatSync(Number(entry), { bigint: true });
                  return [`${stat.dev}:${stat.ino}`];
                } catch {
                  return [];
                }
              }),
            );
            assert.equal(openIdentities.has(selectedKey), false);
            replaced = true;
            const replacementPath = path.join(root, `.${mode}.replacement`);
            fs.writeFileSync(replacementPath, replacementBytes, { mode: 0o600 });
            fs.renameSync(replacementPath, targetPath);
            const changed = fs.statSync(targetPath, { bigint: true });
            assert.notEqual(
              `${changed.dev}:${changed.ino}`,
              selectedKey,
              `${mode}:${boundary}`,
            );
          },
        }), /after .*pinned descriptor release/);
        assert.equal(replaced, true, `${mode}:${boundary}`);
        assert.deepEqual(
          JSON.parse(fs.readFileSync(targetPath, 'utf8')),
          replacement,
          `${mode}:${boundary}`,
        );
        assert.equal(fs.statSync(targetPath).nlink, 1);
        assert.equal(
          fs.readdirSync(root).some((name) => name.includes('.publish-')),
          false,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('publication confirms the target after its first descriptor-free return witness', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const boundary of ['publisher', 'adopter']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-${boundary}-descriptor-free-confirmation-`,
      ));
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const selected = mode === 'generic'
          ? genericControl(`${boundary}-descriptor-free-selected`)
          : campaignReport(`${boundary}-descriptor-free-selected`);
        const replacement = mode === 'generic'
          ? genericControl(`${boundary}-descriptor-free-replacement`)
          : campaignReport(`${boundary}-descriptor-free-replacement`);
        if (boundary === 'adopter') publish(mode, targetPath, selected);
        const attackPhase = boundary === 'publisher'
          ? 'after_publish_return_witness_descriptor_release_before_confirmation'
          : 'after_adopt_return_witness_descriptor_release_before_confirmation';
        let replaced = false;
        assert.throws(() => publish(mode, targetPath, selected, {
          crashInjector(phase) {
            if (phase !== attackPhase || replaced) return;
            const selectedIdentity = fs.statSync(targetPath, { bigint: true });
            const selectedKey = `${selectedIdentity.dev}:${selectedIdentity.ino}`;
            const openIdentities = new Set(
              fs.readdirSync('/proc/self/fd').flatMap((entry) => {
                try {
                  const stat = fs.fstatSync(Number(entry), { bigint: true });
                  return [`${stat.dev}:${stat.ino}`];
                } catch {
                  return [];
                }
              }),
            );
            assert.equal(openIdentities.has(selectedKey), false);
            replaced = true;
            const replacementPath = path.join(root, `.${mode}.confirmation-replacement`);
            fs.writeFileSync(
              replacementPath,
              `${JSON.stringify(replacement, null, 2)}\n`,
              { mode: 0o600 },
            );
            fs.renameSync(replacementPath, targetPath);
          },
        }), /after .*pinned descriptor release/);
        assert.equal(replaced, true, `${mode}:${boundary}`);
        assert.deepEqual(
          JSON.parse(fs.readFileSync(targetPath, 'utf8')),
          replacement,
          `${mode}:${boundary}`,
        );
        assert.equal(fs.statSync(targetPath).nlink, 1);
        assert.equal(
          fs.readdirSync(root).some((name) => name.includes('.publish-')),
          false,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('campaign adoption requires exact bytes, not only equivalent signed JSON', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-campaign-exact-bytes-'));
  try {
    const targetPath = path.join(root, 'campaign.json');
    const report = campaignReport('equivalent-bytes');
    fs.writeFileSync(targetPath, JSON.stringify(report), { mode: 0o600 });
    assert.equal(
      verifyPhdCampaignReport(JSON.parse(fs.readFileSync(targetPath)), signingSecret),
      true,
    );
    assert.throws(
      () => atomicWritePhdCampaignReport(
        targetPath,
        report,
        signingSecret,
        { fixtureOnly: true },
      ),
      /different bytes|entry is unsafe/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publication authenticates the exact serialized bytes after in-memory validation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-publish-serialized-auth-'));
  try {
    const targetPath = path.join(root, 'authenticated.json');
    const record = {
      schemaVersion: 'generic.control.v1',
      authenticated: true,
    };
    let firstValidation = true;
    assert.throws(
      () => atomicWriteAuthenticatedJson(targetPath, record, {
        fixtureOnly: true,
        authenticate(candidate) {
          if (firstValidation) {
            firstValidation = false;
            candidate.authenticated = false;
            return true;
          }
          return candidate.authenticated === true;
        },
      }),
      /unauthenticated serialized output/,
    );
    assert.equal(fs.existsSync(targetPath), false);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publication re-authenticates the named staging bytes immediately before no-replace link', () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-publish-prelink-reauth-',
  ));
  try {
    const targetPath = path.join(root, 'authenticated.json');
    const record = {
      schemaVersion: 'generic.control.v1',
      authenticated: true,
    };
    let permit = true;
    let validations = 0;
    assert.throws(
      () => atomicWriteAuthenticatedJson(targetPath, record, {
        fixtureOnly: true,
        authenticate(candidate) {
          validations += 1;
          return permit && candidate.authenticated === true;
        },
        crashInjector(phase) {
          if (phase === 'before_target_link_revalidation') permit = false;
        },
      }),
      /staging identity changed before no-replace link/,
    );
    assert.equal(validations >= 4, true);
    assert.equal(fs.existsSync(targetPath), false);
    assert.equal(
      fs.readdirSync(root).some((name) => name.includes('.publish-')),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publication rejects symlinked parents, symlink targets, and unknown hard links', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-publish-nofollow-'));
  try {
    const actualParent = path.join(root, 'actual');
    const linkedParent = path.join(root, 'linked');
    fs.mkdirSync(actualParent, { mode: 0o700 });
    fs.symlinkSync(actualParent, linkedParent);
    assert.throws(
      () => atomicWriteAuthenticatedJson(
        path.join(linkedParent, 'output.json'),
        { safe: true },
        { fixtureOnly: true },
      ),
      /ELOOP|ENOTDIR|unsafe/,
    );
    assert.equal(fs.existsSync(path.join(actualParent, 'output.json')), false);

    const backing = path.join(root, 'backing.json');
    const symlinkTarget = path.join(root, 'symlink-target.json');
    fs.writeFileSync(backing, '{"safe":true}\n', { mode: 0o600 });
    fs.symlinkSync(backing, symlinkTarget);
    assert.throws(
      () => atomicWriteAuthenticatedJson(
        symlinkTarget,
        { safe: true },
        { fixtureOnly: true },
      ),
      /ELOOP|unsafe/,
    );

    const record = { safe: 'hard-link' };
    const hardlinkTarget = path.join(root, 'hardlink-target.json');
    const hardlinkAlias = path.join(root, 'hardlink-alias.json');
    fs.writeFileSync(
      hardlinkTarget,
      `${JSON.stringify(record, null, 2)}\n`,
      { mode: 0o600 },
    );
    fs.linkSync(hardlinkTarget, hardlinkAlias);
    assert.throws(
      () => atomicWriteAuthenticatedJson(
        hardlinkTarget,
        record,
        { fixtureOnly: true },
      ),
      /unknown hard link/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generic and campaign publication reject rather than chmod an unsafe parent', () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-unsafe-parent-`,
    ));
    try {
      const parent = path.join(root, 'preexisting-output');
      const targetPath = path.join(parent, `${mode}.json`);
      fs.mkdirSync(parent, { mode: 0o700 });
      fs.chmodSync(parent, 0o755);
      const value = mode === 'generic'
        ? genericControl('unsafe-parent')
        : campaignReport('unsafe-parent');
      assert.throws(
        () => publish(mode, targetPath, value),
        /publication parent must already be owner-only/,
      );
      assert.equal(fs.statSync(parent).mode & 0o7777, 0o755);
      assert.deepEqual(fs.readdirSync(parent), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('generic and campaign publication reject a private parent beneath an unsafe ancestor', () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-unsafe-ancestor-`,
    ));
    try {
      const unsafeAncestor = path.join(root, 'group-writable');
      const privateParent = path.join(unsafeAncestor, 'private-output');
      fs.mkdirSync(unsafeAncestor, { mode: 0o700 });
      fs.mkdirSync(privateParent, { mode: 0o700 });
      fs.chmodSync(unsafeAncestor, 0o770);
      const targetPath = path.join(privateParent, `${mode}.json`);
      const value = mode === 'generic'
        ? genericControl('unsafe-ancestor')
        : campaignReport('unsafe-ancestor');
      assert.throws(
        () => publish(mode, targetPath, value),
        /publication ancestor is unsafe/,
      );
      assert.equal(fs.statSync(unsafeAncestor).mode & 0o7777, 0o770);
      assert.equal(fs.statSync(privateParent).mode & 0o7777, 0o700);
      assert.deepEqual(fs.readdirSync(privateParent), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('generic and campaign publication inspect every directory identity losslessly', () => {
  const originalFstatSync = fs.fstatSync;
  let bigintDirectoryObservations = 0;
  fs.fstatSync = function instrumentDirectoryObservation(descriptor, options) {
    const observation = originalFstatSync.call(fs, descriptor, options);
    if (observation.isDirectory()) {
      assert.equal(
        options?.bigint,
        true,
        'directory device and inode identity must never be narrowed to Number',
      );
      bigintDirectoryObservations += 1;
    }
    return observation;
  };
  try {
    for (const mode of ['generic', 'campaign']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-lossless-parent-`,
      ));
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const value = mode === 'generic'
          ? genericControl('lossless-parent')
          : campaignReport('lossless-parent');
        publish(mode, targetPath, value);
        assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), value);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  } finally {
    fs.fstatSync = originalFstatSync;
  }
  assert.equal(bigintDirectoryObservations > 0, true);
});

test('generic and campaign adoption reject targets detached from the parent filesystem', () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-detached-target-filesystem-`,
    ));
    const originalOpenSync = fs.openSync;
    const originalFstatSync = fs.fstatSync;
    const targetDescriptors = new Set();
    try {
      const targetPath = path.join(root, `${mode}.json`);
      const value = mode === 'generic'
        ? genericControl('detached-target-filesystem')
        : campaignReport('detached-target-filesystem');
      publish(mode, targetPath, value);
      fs.openSync = function captureTargetDescriptor(target, flags, ...rest) {
        const descriptor = originalOpenSync.call(fs, target, flags, ...rest);
        if (String(target).endsWith(`/${path.basename(targetPath)}`)
            && (flags & fs.constants.O_ACCMODE) === fs.constants.O_RDONLY) {
          targetDescriptors.add(descriptor);
        }
        return descriptor;
      };
      fs.fstatSync = function detachTargetFilesystem(descriptor, options) {
        const observation = originalFstatSync.call(fs, descriptor, options);
        if (targetDescriptors.has(descriptor) && observation.isFile()) {
          assert.equal(options?.bigint, true);
          observation.dev += 1n;
        }
        return observation;
      };
      assert.throws(
        () => publish(mode, targetPath, value),
        /publication entry is unsafe/,
        mode,
      );
    } finally {
      fs.openSync = originalOpenSync;
      fs.fstatSync = originalFstatSync;
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('generic and campaign reject same-device targets and crash stages on a detached mount', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const substitution of ['target', 'stage']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-detached-${substitution}-mount-`,
      ));
      const originalOpenSync = fs.openSync;
      const originalReadFileSync = fs.readFileSync;
      const detachedDescriptors = new Set();
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const value = mode === 'generic'
          ? genericControl(`detached-${substitution}-mount`)
          : campaignReport(`detached-${substitution}-mount`);
        const detachedName = substitution === 'target'
          ? path.basename(targetPath)
          : `.${path.basename(targetPath)}.publish-${'a'.repeat(32)}.tmp`;
        if (substitution === 'target') {
          publish(mode, targetPath, value);
        } else {
          fs.writeFileSync(
            path.join(root, detachedName),
            `${JSON.stringify(value, null, 2)}\n`,
            { mode: 0o600 },
          );
        }
        fs.openSync = function captureDetachedDescriptor(target, flags, ...rest) {
          const descriptor = originalOpenSync.call(fs, target, flags, ...rest);
          if (String(target).endsWith(`/${detachedName}`)
              && (flags & fs.constants.O_ACCMODE) === fs.constants.O_RDONLY) {
            detachedDescriptors.add(descriptor);
          }
          return descriptor;
        };
        fs.readFileSync = function detachPublicationMount(target, ...rest) {
          const bytes = originalReadFileSync.call(fs, target, ...rest);
          const match = /^\/proc\/self\/fdinfo\/([0-9]+)$/.exec(String(target));
          if (match === null || !detachedDescriptors.has(Number(match[1]))) {
            return bytes;
          }
          assert.equal(Buffer.isBuffer(bytes), true);
          const changed = bytes.toString('utf8').replace(
            /^mnt_id:\s*([1-9][0-9]*)\s*$/m,
            (_line, mountId) => `mnt_id:\t${BigInt(mountId) + 1n}`,
          );
          assert.notDeepEqual(Buffer.from(changed), bytes);
          return Buffer.from(changed);
        };
        assert.throws(
          () => publish(mode, targetPath, value),
          /publication entry is unsafe/,
          `${mode}:${substitution}`,
        );
      } finally {
        fs.openSync = originalOpenSync;
        fs.readFileSync = originalReadFileSync;
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('generic and campaign publication reject FIFOs with nonblocking no-follow reads', () => {
  for (const mode of ['generic', 'campaign']) {
    for (const substitution of ['target', 'staging']) {
      const root = fs.mkdtempSync(path.join(
        os.tmpdir(),
        `clos-${mode}-${substitution}-fifo-`,
      ));
      const originalOpenSync = fs.openSync;
      let nonblockingObservationCount = 0;
      try {
        const targetPath = path.join(root, `${mode}.json`);
        const value = mode === 'generic'
          ? genericControl(`${substitution}-fifo`)
          : campaignReport(`${substitution}-fifo`);
        const substitutedName = substitution === 'target'
          ? path.basename(targetPath)
          : `.${path.basename(targetPath)}.publish-${
            'a'.repeat(32)
          }.tmp`;
        makeFifo(path.join(root, substitutedName));
        fs.openSync = function assertNonblockingSpecialOpen(
          target,
          flags,
          ...rest
        ) {
          if (String(target).endsWith(`/${substitutedName}`)) {
            assert.notEqual(
              flags & fs.constants.O_NONBLOCK,
              0,
              'authenticated publication must not block before rejecting a special file',
            );
            nonblockingObservationCount += 1;
          }
          return originalOpenSync.call(fs, target, flags, ...rest);
        };
        assert.throws(
          () => publish(mode, targetPath, value),
          /entry is unsafe/,
          `${mode}:${substitution}`,
        );
        assert.equal(nonblockingObservationCount > 0, true);
        assert.equal(
          fs.lstatSync(path.join(root, substitutedName)).isFIFO(),
          true,
        );
      } finally {
        fs.openSync = originalOpenSync;
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('generic and campaign publication bound exact target reads across in-place growth', () => {
  for (const mode of ['generic', 'campaign']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-${mode}-bounded-growth-`,
    ));
    const originalReadSync = fs.readSync;
    try {
      const targetPath = path.join(root, `${mode}.json`);
      const value = mode === 'generic'
        ? genericControl('bounded-growth')
        : campaignReport('bounded-growth');
      const expectedBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      fs.writeFileSync(targetPath, expectedBytes, { mode: 0o600 });
      const targetIdentity = fs.statSync(targetPath, { bigint: true });
      let grewDuringRead = false;
      let maximumRequestedBytes = 0;
      fs.readSync = function growExactTargetAfterMetadataCheck(
        descriptor,
        buffer,
        offset,
        length,
        position,
      ) {
        const observed = fs.fstatSync(descriptor, { bigint: true });
        if (observed.dev === targetIdentity.dev
            && observed.ino === targetIdentity.ino) {
          maximumRequestedBytes = Math.max(maximumRequestedBytes, length);
          if (!grewDuringRead) {
            fs.appendFileSync(targetPath, Buffer.from('#'));
            grewDuringRead = true;
          }
        }
        return originalReadSync.call(
          fs,
          descriptor,
          buffer,
          offset,
          length,
          position,
        );
      };
      assert.throws(
        () => publish(mode, targetPath, value),
        /entry changed while reading/,
        mode,
      );
      assert.equal(grewDuringRead, true, mode);
      assert.equal(maximumRequestedBytes <= expectedBytes.length, true, mode);
      assert.deepEqual(
        fs.readFileSync(targetPath),
        Buffer.concat([expectedBytes, Buffer.from('#')]),
        mode,
      );
    } finally {
      fs.readSync = originalReadSync;
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('production publication is unavailable to the candidate UID after final handoff', {
  skip: typeof process.geteuid !== 'function' || process.geteuid() === 0,
}, () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-production-publication-boundary-',
  ));
  try {
    const targetPath = path.join(root, 'control.json');
    const value = genericControl('production-boundary');
    let descriptorReleaseWitnessReached = false;
    let brokerFinalCloseReached = false;
    assert.throws(
      () => atomicWriteAuthenticatedJson(targetPath, value, {
        crashInjector(phase) {
          if (phase === 'root_broker_after_authority_handoff') {
            brokerFinalCloseReached = true;
          }
          if (phase.includes('descriptor_release')) {
            descriptorReleaseWitnessReached = true;
          }
        },
      }),
      /production root authority requires/,
    );
    assert.equal(descriptorReleaseWitnessReached, false);
    assert.equal(brokerFinalCloseReached, false);
    assert.equal(fs.existsSync(targetPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mapped user-namespace root cannot publish or consume production authority', {
  skip: !mappedRootNamespaceAvailable,
}, () => {
  for (const probe of ['productionProbe', 'readerProductionProbe']) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-mapped-root-authority-${probe}-`,
    ));
    const inputPath = path.join(root, 'input.json');
    const targetPath = path.join(root, 'authority', 'control.json');
    try {
      fs.writeFileSync(inputPath, `${JSON.stringify({
        attackFinalClose: false,
        crashPhase: null,
        [probe]: true,
        record: {
          schemaVersion: 'root.broker.regression.v1',
          authenticated: true,
          identity: `mapped-root-${probe}`,
        },
        resultPath: path.join(root, 'result.json'),
        targetPath,
      })}\n`, { mode: 0o600 });
      const attempted = spawnSync('/usr/bin/unshare', [
        '--user',
        '--map-root-user',
        process.execPath,
        rootBrokerChildPath,
        inputPath,
      ], {
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.notEqual(attempted.status, 0, probe);
      assert.match(
        attempted.stderr,
        /initial Linux user namespace; mapped namespace root is not authority/,
        probe,
      );
      if (probe === 'productionProbe') {
        assert.equal(fs.existsSync(targetPath), false, probe);
      } else {
        assert.equal(fs.existsSync(targetPath), true, probe);
      }
    } finally {
      const authority = path.dirname(targetPath);
      const objectDirectory = path.join(authority, '.authenticated-objects');
      if (fs.existsSync(objectDirectory)) fs.chmodSync(objectDirectory, 0o700);
      if (fs.existsSync(authority)) fs.chmodSync(authority, 0o700);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('production broker seals both naming layers before authority handoff', () => {
  const source = fs.readFileSync(
    path.join(closRoot, 'src', 'authenticated-file-publication.mjs'),
    'utf8',
  );
  const broker = source.slice(
    source.indexOf('function publishThroughRootAuthorityBroker'),
    source.indexOf('export function atomicWriteAuthenticatedJson'),
  );
  const parentSeal = broker.indexOf('sealRootAuthorityDirectory(handle);');
  const objectOpen = broker.indexOf('openRootObjectDirectory(handle');
  const objectCommit = broker.indexOf('createRootSealedEntry(');
  const handoff = broker.indexOf(
    "injectCrash(crashInjector, 'root_broker_after_authority_handoff')",
  );
  assert.ok(parentSeal >= 0 && parentSeal < objectOpen);
  assert.ok(objectOpen < objectCommit && objectCommit < handoff);
  assert.match(
    source.slice(
      source.indexOf('function openRootAuthoritySubdirectory'),
      source.indexOf('function sealRootAuthorityDirectory'),
    ),
    /fs[.]fchmodSync\(descriptor, 0o500\)/,
  );
  assert.match(
    broker,
    /allowedFinalModes:\s*\[0o500, 0o700\]/,
  );
});

test('root broker crash recovery seals content and rejects the final candidate mutation', {
  skip: !mappedRootNamespaceAvailable,
}, () => {
  for (const crashPhase of [
    'root_object_after_stage_create',
    'root_object_after_stage_fsync',
    'root_object_after_link',
    'root_broker_after_object_commit',
    'root_target_after_stage_create',
    'root_target_after_stage_fsync',
    'root_target_after_link',
    'root_broker_after_target_commit',
    'root_broker_after_authority_handoff',
    'root_broker_after_final_confirmation_descriptor_release',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-root-broker-${crashPhase}-`,
    ));
    if (process.geteuid() === 0) fs.chmodSync(root, 0o711);
    const attackExchange = fs.mkdtempSync(path.join(
      os.tmpdir(),
      'clos-root-broker-candidate-',
    ));
    fs.chmodSync(attackExchange, 0o733);
    const candidateAttackerPath = path.join(
      attackExchange,
      'candidate-attacker.mjs',
    );
    fs.copyFileSync(rootBrokerAttackerPath, candidateAttackerPath);
    fs.chmodSync(candidateAttackerPath, 0o555);
    const authority = path.join(root, 'authority');
    const inputPath = path.join(attackExchange, 'input.json');
    const resultPath = path.join(root, 'result.json');
    const targetPath = path.join(authority, 'control.json');
    const attackReadyPath = path.join(attackExchange, 'attack.ready');
    const attackResultPath = path.join(attackExchange, 'attack.result');
    const attackReplacementPath = path.join(attackExchange, 'replacement.json');
    const attackUid = process.geteuid() === 0 ? 65534 : process.geteuid();
    const attackGid = process.getegid() === 0 ? 65534 : process.getegid();
    const record = {
      schemaVersion: 'root.broker.regression.v1',
      authenticated: true,
      identity: crashPhase,
    };
    const run = (selectedCrashPhase) => {
      fs.writeFileSync(inputPath, `${JSON.stringify({
        attackFinalClose: selectedCrashPhase === null,
        attackReadyPath,
        attackReplacementPath,
        attackResultPath,
        attackUid,
        crashPhase: selectedCrashPhase,
        record,
        resultPath,
        targetPath,
      })}\n`, { mode: 0o644 });
      if (selectedCrashPhase === null) {
        fs.writeFileSync(
          attackReplacementPath,
          `${JSON.stringify({ ...record, identity: 'candidate-replacement' })}\n`,
          { mode: 0o600 },
        );
        return spawnSync('/bin/bash', [
          '-c',
          [
            'if [ "$6" = "root" ]; then',
            '/usr/bin/setpriv --reuid="$7" --regid="$8" --clear-groups',
            '"$1" "$2" "$3" &',
            'else "$1" "$2" "$3" & fi;',
            'exec "$4" --user --map-root-user "$1" "$5" "$3"',
          ].join(' '),
          'root-broker-final-close-coordinator',
          process.execPath,
          candidateAttackerPath,
          inputPath,
          '/usr/bin/unshare',
          rootBrokerChildPath,
          process.geteuid() === 0 ? 'root' : 'candidate',
          String(attackUid),
          String(attackGid),
        ], {
          encoding: 'utf8',
          timeout: 30_000,
        });
      }
      return spawnSync('/usr/bin/unshare', [
        '--user',
        '--map-root-user',
        process.execPath,
        rootBrokerChildPath,
        inputPath,
      ], {
        encoding: 'utf8',
        timeout: 30_000,
      });
    };
    try {
      const interrupted = run(crashPhase);
      assert.equal(interrupted.signal, 'SIGKILL', crashPhase);
      assert.equal(
        (fs.statSync(authority).mode & 0o7777)
          .toString(8).padStart(4, '0'),
        '0500',
        crashPhase,
      );
      if (crashPhase === 'root_object_after_stage_create') {
        const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
        const digest = crypto.createHash('sha256').update(bytes).digest('hex');
        const objectDirectory = path.join(authority, '.authenticated-objects');
        const partialStage = path.join(
          objectDirectory,
          `.${digest}.json.root-publish-${'a'.repeat(32)}.tmp`,
        );
        fs.chmodSync(objectDirectory, 0o700);
        fs.writeFileSync(
          partialStage,
          bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 2))),
          { mode: 0o600 },
        );
        fs.chmodSync(objectDirectory, 0o500);
      }

      const recovered = run(null);
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(fs.existsSync(resultPath), true, JSON.stringify({
        error: recovered.error?.message,
        signal: recovered.signal,
        status: recovered.status,
        stderr: recovered.stderr,
      }));
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      assert.deepEqual(result.record, record);
      assert.equal(result.consumedIdentity, record.identity);
      assert.equal(result.consumedUnderPinnedDescriptor, true);
      assert.equal(result.parentMode, '0500');
      assert.equal(result.objectDirectoryMode, '0500');
      assert.equal(result.targetMode, '0400');
      assert.equal(result.objectMode, '0400');
      assert.match(
        result.finalCloseMutation,
        new RegExp(`^denied:(EACCES|EPERM):uid-${attackUid}$`),
      );
      assert.deepEqual(result.stagingEntries, []);

      const replacement = path.join(
        attackExchange,
        'post-return-replacement.json',
      );
      fs.writeFileSync(
        replacement,
        `${JSON.stringify({ ...record, identity: 'hostile' })}\n`,
        { mode: 0o600 },
      );
      assertCandidateRenameDenied(replacement, targetPath, crashPhase);
      assert.deepEqual(
        JSON.parse(fs.readFileSync(targetPath, 'utf8')),
        record,
        crashPhase,
      );
    } finally {
      if (fs.existsSync(path.join(authority, '.authenticated-objects'))) {
        fs.chmodSync(path.join(authority, '.authenticated-objects'), 0o700);
      }
      if (fs.existsSync(authority)) fs.chmodSync(authority, 0o700);
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(attackExchange, { recursive: true, force: true });
    }
  }
});

test('root broker reconciles an orphaned object stage before publishing a different digest', {
  skip: !mappedRootNamespaceAvailable,
}, () => {
  for (const crashPhase of [
    'root_object_after_stage_create',
    'root_object_after_stage_fsync',
    'root_object_after_link',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-root-broker-cross-digest-${crashPhase}-`,
    ));
    const authority = path.join(root, 'authority');
    const inputPath = path.join(root, 'input.json');
    const resultPath = path.join(root, 'result.json');
    const targetPath = path.join(authority, 'control.json');
    const original = {
      schemaVersion: 'root.broker.regression.v1',
      authenticated: true,
      identity: `interrupted-${crashPhase}`,
    };
    const successor = {
      ...original,
      identity: `successor-${crashPhase}`,
    };
    const run = (record, selectedCrashPhase) => {
      fs.writeFileSync(inputPath, `${JSON.stringify({
        crashPhase: selectedCrashPhase,
        record,
        resultPath,
        targetPath,
      })}\n`, { mode: 0o600 });
      return spawnSync('/usr/bin/unshare', [
        '--user',
        '--map-root-user',
        process.execPath,
        rootBrokerChildPath,
        inputPath,
      ], {
        encoding: 'utf8',
        timeout: 30_000,
      });
    };
    try {
      const interrupted = run(original, crashPhase);
      assert.equal(interrupted.signal, 'SIGKILL', crashPhase);
      assert.equal(fs.existsSync(targetPath), false, crashPhase);

      const recovered = run(successor, null);
      assert.equal(recovered.status, 0, recovered.stderr);
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      assert.deepEqual(result.record, successor, crashPhase);
      assert.equal(result.consumedIdentity, successor.identity, crashPhase);
      assert.deepEqual(result.stagingEntries, [], crashPhase);
      const objectDirectory = path.join(authority, '.authenticated-objects');
      const interruptedDigest = crypto.createHash('sha256').update(
        Buffer.from(`${JSON.stringify(original, null, 2)}\n`),
      ).digest('hex');
      assert.equal(
        fs.existsSync(path.join(objectDirectory, `${interruptedDigest}.json`)),
        crashPhase === 'root_object_after_link',
        crashPhase,
      );
    } finally {
      if (fs.existsSync(path.join(authority, '.authenticated-objects'))) {
        fs.chmodSync(path.join(authority, '.authenticated-objects'), 0o700);
      }
      if (fs.existsSync(authority)) fs.chmodSync(authority, 0o700);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('root broker fails closed on corrupted sealed pre-link stages', {
  skip: !mappedRootNamespaceAvailable,
}, () => {
  for (const crashPhase of [
    'root_object_after_stage_fsync',
    'root_target_after_stage_fsync',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-root-broker-sealed-stage-corruption-${crashPhase}-`,
    ));
    const authority = path.join(root, 'authority');
    const inputPath = path.join(root, 'input.json');
    const resultPath = path.join(root, 'result.json');
    const targetPath = path.join(authority, 'control.json');
    const original = {
      schemaVersion: 'root.broker.regression.v1',
      authenticated: true,
      identity: `sealed-original-${crashPhase}`,
    };
    const successor = {
      ...original,
      identity: `sealed-successor-${crashPhase}`,
    };
    const run = (record, selectedCrashPhase) => {
      fs.writeFileSync(inputPath, `${JSON.stringify({
        crashPhase: selectedCrashPhase,
        record,
        resultPath,
        targetPath,
      })}\n`, { mode: 0o600 });
      return spawnSync('/usr/bin/unshare', [
        '--user',
        '--map-root-user',
        process.execPath,
        rootBrokerChildPath,
        inputPath,
      ], {
        encoding: 'utf8',
        timeout: 30_000,
      });
    };
    try {
      const interrupted = run(original, crashPhase);
      assert.equal(interrupted.signal, 'SIGKILL', crashPhase);
      assert.equal(fs.existsSync(targetPath), false, crashPhase);
      const stageDirectory = crashPhase.startsWith('root_object_')
        ? path.join(authority, '.authenticated-objects')
        : authority;
      const stages = fs.readdirSync(stageDirectory).filter(
        (name) => name.includes('.root-publish-'),
      );
      assert.equal(stages.length, 1, crashPhase);
      const stagePath = path.join(stageDirectory, stages[0]);
      assert.equal(
        (fs.statSync(stagePath).mode & 0o7777)
          .toString(8).padStart(4, '0'),
        '0400',
        crashPhase,
      );
      fs.chmodSync(stageDirectory, 0o700);
      fs.chmodSync(stagePath, 0o600);
      fs.writeFileSync(
        stagePath,
        `${JSON.stringify({
          schemaVersion: 'root.broker.regression.v1',
          authenticated: true,
          identity: `canonical-corruption-${crashPhase}`,
        }, null, 2)}\n`,
      );
      fs.chmodSync(stagePath, 0o400);
      fs.chmodSync(stageDirectory, 0o500);

      const rejected = run(successor, null);
      assert.notEqual(rejected.status, 0, crashPhase);
      assert.match(
        rejected.stderr,
        /sealed root-authority crash stage is unsafe|root-authority crash stage is unsafe/,
        crashPhase,
      );
      assert.equal(fs.existsSync(resultPath), false, crashPhase);
      assert.equal(fs.existsSync(stagePath), true, crashPhase);
      assert.equal(fs.existsSync(targetPath), false, crashPhase);
    } finally {
      if (fs.existsSync(path.join(authority, '.authenticated-objects'))) {
        fs.chmodSync(path.join(authority, '.authenticated-objects'), 0o700);
      }
      if (fs.existsSync(authority)) fs.chmodSync(authority, 0o700);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('root broker crash-safely quarantines ambiguous sealed legacy alias stages', {
  skip: !mappedRootNamespaceAvailable,
}, () => {
  for (const quarantineCrashPhase of [
    'root_quarantine_after_link',
    'root_quarantine_after_link_fsync',
    'root_quarantine_after_source_unlink',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-root-broker-legacy-quarantine-${quarantineCrashPhase}-`,
    ));
    const authority = path.join(root, 'authority');
    const inputPath = path.join(root, 'input.json');
    const resultPath = path.join(root, 'result.json');
    const targetPath = path.join(authority, 'control.json');
    const original = {
      schemaVersion: 'root.broker.regression.v1',
      authenticated: true,
      identity: `legacy-original-${quarantineCrashPhase}`,
    };
    const successor = {
      ...original,
      identity: `legacy-successor-${quarantineCrashPhase}`,
    };
    const run = (record, crashPhase) => {
      fs.writeFileSync(inputPath, `${JSON.stringify({
        crashPhase,
        record,
        resultPath,
        targetPath,
      })}\n`, { mode: 0o600 });
      return spawnSync('/usr/bin/unshare', [
        '--user',
        '--map-root-user',
        process.execPath,
        rootBrokerChildPath,
        inputPath,
      ], {
        encoding: 'utf8',
        timeout: 30_000,
      });
    };
    try {
      const interruptedPublication = run(
        original,
        'root_target_after_stage_fsync',
      );
      assert.equal(
        interruptedPublication.signal,
        'SIGKILL',
        quarantineCrashPhase,
      );
      const stageName = fs.readdirSync(authority).find(
        (name) => name.includes('.root-publish-'),
      );
      assert.ok(stageName, quarantineCrashPhase);
      const currentMatch = /^(.*[.]root-publish-)[0-9a-f]{64}-([0-9a-f]{32}[.]tmp)$/
        .exec(stageName);
      assert.ok(currentMatch, stageName);
      const legacyStageName = `${currentMatch[1]}${currentMatch[2]}`;
      fs.chmodSync(authority, 0o700);
      fs.renameSync(
        path.join(authority, stageName),
        path.join(authority, legacyStageName),
      );
      fs.chmodSync(authority, 0o500);

      const interruptedQuarantine = run(
        successor,
        quarantineCrashPhase,
      );
      assert.equal(
        interruptedQuarantine.signal,
        'SIGKILL',
        quarantineCrashPhase,
      );
      const recovered = run(successor, null);
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.deepEqual(
        JSON.parse(fs.readFileSync(targetPath, 'utf8')),
        successor,
        quarantineCrashPhase,
      );
      const quarantineDirectory = path.join(
        authority,
        '.authenticated-quarantine',
      );
      const quarantineEntries = fs.readdirSync(quarantineDirectory);
      assert.equal(quarantineEntries.length, 1, quarantineCrashPhase);
      const quarantinePath = path.join(
        quarantineDirectory,
        quarantineEntries[0],
      );
      assert.deepEqual(
        JSON.parse(fs.readFileSync(quarantinePath, 'utf8')),
        original,
        quarantineCrashPhase,
      );
      const quarantineStat = fs.statSync(quarantinePath);
      assert.equal(quarantineStat.mode & 0o7777, 0o400);
      assert.equal(quarantineStat.nlink, 1);
      assert.equal(
        fs.statSync(quarantineDirectory).mode & 0o7777,
        0o500,
      );
      assert.deepEqual(
        fs.readdirSync(authority).filter(
          (name) => name.includes('.root-publish-'),
        ),
        [],
        quarantineCrashPhase,
      );
    } finally {
      for (const protectedName of [
        '.authenticated-objects',
        '.authenticated-quarantine',
      ]) {
        const protectedDirectory = path.join(authority, protectedName);
        if (fs.existsSync(protectedDirectory)) {
          fs.chmodSync(protectedDirectory, 0o700);
        }
      }
      if (fs.existsSync(authority)) fs.chmodSync(authority, 0o700);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('root broker quarantines a linked legacy alias before admitting an authenticated retry', {
  skip: !mappedRootNamespaceAvailable,
}, () => {
  for (const quarantineCrashPhase of [
    'root_quarantine_after_link',
    'root_quarantine_after_link_fsync',
    'root_quarantine_after_final_unlink',
    'root_quarantine_after_source_unlink',
  ]) {
    const root = fs.mkdtempSync(path.join(
      os.tmpdir(),
      `clos-root-broker-linked-legacy-quarantine-${quarantineCrashPhase}-`,
    ));
    const authority = path.join(root, 'authority');
    const inputPath = path.join(root, 'input.json');
    const resultPath = path.join(root, 'result.json');
    const targetPath = path.join(authority, 'control.json');
    const original = {
      schemaVersion: 'root.broker.regression.v1',
      authenticated: true,
      identity: `linked-legacy-original-${quarantineCrashPhase}`,
    };
    const successor = {
      ...original,
      identity: `linked-legacy-successor-${quarantineCrashPhase}`,
    };
    const run = (record, crashPhase) => {
      fs.writeFileSync(inputPath, `${JSON.stringify({
        crashPhase,
        record,
        resultPath,
        targetPath,
      })}\n`, { mode: 0o600 });
      return spawnSync('/usr/bin/unshare', [
        '--user',
        '--map-root-user',
        process.execPath,
        rootBrokerChildPath,
        inputPath,
      ], {
        encoding: 'utf8',
        timeout: 30_000,
      });
    };
    try {
      const interruptedPublication = run(original, 'root_target_after_link');
      assert.equal(
        interruptedPublication.signal,
        'SIGKILL',
        quarantineCrashPhase,
      );
      assert.deepEqual(
        JSON.parse(fs.readFileSync(targetPath, 'utf8')),
        original,
        quarantineCrashPhase,
      );
      const stageName = fs.readdirSync(authority).find(
        (name) => name.includes('.root-publish-'),
      );
      assert.ok(stageName, quarantineCrashPhase);
      assert.equal(
        fs.statSync(path.join(authority, stageName)).nlink,
        2,
        quarantineCrashPhase,
      );
      const currentMatch = /^(.*[.]root-publish-)[0-9a-f]{64}-([0-9a-f]{32}[.]tmp)$/
        .exec(stageName);
      assert.ok(currentMatch, stageName);
      const legacyStageName = `${currentMatch[1]}${currentMatch[2]}`;
      fs.chmodSync(authority, 0o700);
      fs.renameSync(
        path.join(authority, stageName),
        path.join(authority, legacyStageName),
      );
      fs.chmodSync(authority, 0o500);

      const interruptedQuarantine = run(successor, quarantineCrashPhase);
      assert.equal(
        interruptedQuarantine.signal,
        'SIGKILL',
        quarantineCrashPhase,
      );
      const recoveryRecord = quarantineCrashPhase
        === 'root_quarantine_after_source_unlink'
        ? successor
        : original;
      const recovered = run(recoveryRecord, null);
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.deepEqual(
        JSON.parse(fs.readFileSync(targetPath, 'utf8')),
        recoveryRecord,
        quarantineCrashPhase,
      );
      const quarantineDirectory = path.join(
        authority,
        '.authenticated-quarantine',
      );
      const quarantineEntries = fs.readdirSync(quarantineDirectory);
      assert.equal(quarantineEntries.length, 1, quarantineCrashPhase);
      const quarantinePath = path.join(
        quarantineDirectory,
        quarantineEntries[0],
      );
      assert.deepEqual(
        JSON.parse(fs.readFileSync(quarantinePath, 'utf8')),
        original,
        quarantineCrashPhase,
      );
      const quarantineStat = fs.statSync(quarantinePath);
      assert.equal(quarantineStat.mode & 0o7777, 0o400);
      assert.equal(quarantineStat.nlink, 1);
      assert.deepEqual(
        fs.readdirSync(authority).filter(
          (name) => name.includes('.root-publish-'),
        ),
        [],
        quarantineCrashPhase,
      );
    } finally {
      for (const protectedName of [
        '.authenticated-objects',
        '.authenticated-quarantine',
      ]) {
        const protectedDirectory = path.join(authority, protectedName);
        if (fs.existsSync(protectedDirectory)) {
          fs.chmodSync(protectedDirectory, 0o700);
        }
      }
      if (fs.existsSync(authority)) fs.chmodSync(authority, 0o700);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('root-brokered consumers reject noncanonical immutable-object lookalikes', {
  skip: !mappedRootNamespaceAvailable,
}, () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-root-broker-noncanonical-object-',
  ));
  const authority = path.join(root, 'authority');
  const inputPath = path.join(root, 'input.json');
  const resultPath = path.join(root, 'result.json');
  const targetPath = path.join(authority, 'control.json');
  const record = {
    schemaVersion: 'root.broker.regression.v1',
    authenticated: true,
    identity: 'noncanonical-object',
  };
  try {
    fs.writeFileSync(inputPath, `${JSON.stringify({
      crashPhase: null,
      forgeNonCanonical: true,
      record,
      resultPath,
      targetPath,
    })}\n`, { mode: 0o600 });
    const rejected = spawnSync('/usr/bin/unshare', [
      '--user',
      '--map-root-user',
      process.execPath,
      rootBrokerChildPath,
      inputPath,
    ], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.notEqual(rejected.status, 0);
    assert.match(
      rejected.stderr,
      /immutable object is not the canonical broker serialization/,
    );
    assert.equal(fs.existsSync(resultPath), false);
  } finally {
    if (fs.existsSync(path.join(authority, '.authenticated-objects'))) {
      fs.chmodSync(path.join(authority, '.authenticated-objects'), 0o700);
    }
    if (fs.existsSync(authority)) fs.chmodSync(authority, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('root-brokered consumers pin alias and immutable object across one handoff', {
  skip: !mappedRootNamespaceAvailable,
}, () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-root-broker-consumer-handoff-',
  ));
  const authority = path.join(root, 'authority');
  const inputPath = path.join(root, 'input.json');
  const resultPath = path.join(root, 'result.json');
  const targetPath = path.join(authority, 'control.json');
  const record = {
    schemaVersion: 'root.broker.regression.v1',
    authenticated: true,
    identity: 'consumer-handoff-original',
  };
  try {
    fs.writeFileSync(inputPath, `${JSON.stringify({
      attackConsumerAlias: true,
      crashPhase: null,
      record,
      resultPath,
      targetPath,
    })}\n`, { mode: 0o600 });
    const rejected = spawnSync('/usr/bin/unshare', [
      '--user',
      '--map-root-user',
      process.execPath,
      rootBrokerChildPath,
      inputPath,
    ], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.notEqual(rejected.status, 0);
    assert.match(
      rejected.stderr,
      /changed during its protected broker handoff|changed across its pinned consumer handoff|alias or content-addressed immutable object changed across the protected consumer handoff/,
    );
    assert.equal(fs.existsSync(resultPath), false);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(targetPath, 'utf8')),
      { ...record, identity: 'consumer-handoff-replacement' },
    );
  } finally {
    if (fs.existsSync(path.join(authority, '.authenticated-objects'))) {
      fs.chmodSync(path.join(authority, '.authenticated-objects'), 0o700);
    }
    if (fs.existsSync(authority)) fs.chmodSync(authority, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('root-brokered consumers reject final in-place immutable-object mutation', {
  skip: !mappedRootNamespaceAvailable,
}, () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-root-broker-consumer-object-handoff-',
  ));
  const authority = path.join(root, 'authority');
  const inputPath = path.join(root, 'input.json');
  const resultPath = path.join(root, 'result.json');
  const targetPath = path.join(authority, 'control.json');
  const record = {
    schemaVersion: 'root.broker.regression.v1',
    authenticated: true,
    identity: 'consumer-object-original',
  };
  try {
    fs.writeFileSync(inputPath, `${JSON.stringify({
      attackConsumerObject: true,
      crashPhase: null,
      record,
      resultPath,
      targetPath,
    })}\n`, { mode: 0o600 });
    const rejected = spawnSync('/usr/bin/unshare', [
      '--user',
      '--map-root-user',
      process.execPath,
      rootBrokerChildPath,
      inputPath,
    ], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.notEqual(rejected.status, 0);
    assert.match(
      rejected.stderr,
      /changed across its pinned consumer handoff/,
    );
    assert.equal(fs.existsSync(resultPath), false);
  } finally {
    if (fs.existsSync(path.join(authority, '.authenticated-objects'))) {
      fs.chmodSync(path.join(authority, '.authenticated-objects'), 0o700);
    }
    if (fs.existsSync(authority)) fs.chmodSync(authority, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('root-brokered consumers reject deferred descriptor consumption', {
  skip: !mappedRootNamespaceAvailable,
}, () => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'clos-root-broker-async-consumer-',
  ));
  const authority = path.join(root, 'authority');
  const inputPath = path.join(root, 'input.json');
  const resultPath = path.join(root, 'result.json');
  const targetPath = path.join(authority, 'control.json');
  const record = {
    schemaVersion: 'root.broker.regression.v1',
    authenticated: true,
    identity: 'async-consumer',
  };
  try {
    fs.writeFileSync(inputPath, `${JSON.stringify({
      asyncConsumer: true,
      crashPhase: null,
      record,
      resultPath,
      targetPath,
    })}\n`, { mode: 0o600 });
    const rejected = spawnSync('/usr/bin/unshare', [
      '--user',
      '--map-root-user',
      process.execPath,
      rootBrokerChildPath,
      inputPath,
    ], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.notEqual(rejected.status, 0);
    assert.match(
      rejected.stderr,
      /protected consumer must complete synchronously/,
    );
    assert.equal(fs.existsSync(resultPath), false);
  } finally {
    if (fs.existsSync(path.join(authority, '.authenticated-objects'))) {
      fs.chmodSync(path.join(authority, '.authenticated-objects'), 0o700);
    }
    if (fs.existsSync(authority)) fs.chmodSync(authority, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
