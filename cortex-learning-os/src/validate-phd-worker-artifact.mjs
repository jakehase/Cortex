#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { deploymentBindingDigest } from './deployment-identity.mjs';
import {
  validateExecutionEvidenceRecord,
  verifyExecutionEvidenceBytes,
} from './execution-evidence.mjs';
import { assertExecutionClosureAtRoot } from './git-product-source.mjs';
import { sha256File, sha256Text } from './hash.mjs';
import { validatePhdModelCallTerminal } from './phd-terminal-contract.mjs';
import {
  validatePhdWorkerSummaryStatus,
} from './phd-worker-terminal-contract.mjs';
import {
  createResearchReviewAuthorityRequest,
  parseResearchReviewAuthorityRequestBytes,
  serializeResearchReviewAuthorityRequest,
} from './research-review-request.mjs';

function readRegular(target) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsafe artifact file: ${target}`);
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

function digest(value) {
  return sha256Text(canonicalJson(value));
}

function exactKeys(candidate, keys) {
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    && Object.keys(candidate).sort().join(',') === [...keys].sort().join(',');
}

function modeString(mode) {
  return `0${(Number(mode) & 0o7777).toString(8).padStart(3, '0')}`;
}

function expectedDirectoryLinkCount(directory) {
  return 2 + fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).length;
}

export function validateTerminalArtifactMetadata(rootPath, manifest, {
  ownerUid = 0,
  ownerGid = 0,
} = {}) {
  const root = path.resolve(rootPath);
  const publication = manifest?.publication;
  if (!exactKeys(publication, [
    'schemaVersion', 'publisherUid', 'publisherGid', 'rootMode', 'fileMode',
    'directoryMode', 'regularFileLinkCount', 'rootLinkCount',
    'producerWritableTerminal', 'noFollow', 'exactMetadata',
  ])
      || publication.schemaVersion !== 'cortex.learning_os.phd_terminal_publication.v1'
      || publication.publisherUid !== ownerUid
      || publication.publisherGid !== ownerGid
      || publication.rootMode !== '0555'
      || publication.fileMode !== '0444'
      || publication.directoryMode !== '0555'
      || publication.regularFileLinkCount !== 1
      || publication.producerWritableTerminal !== false
      || publication.noFollow !== true
      || publication.exactMetadata !== true) {
    throw new Error('terminal artifact publication policy is invalid');
  }
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()
      || rootStat.uid !== ownerUid || rootStat.gid !== ownerGid
      || modeString(rootStat.mode) !== publication.rootMode
      || rootStat.nlink !== publication.rootLinkCount
      || rootStat.nlink !== expectedDirectoryLinkCount(root)) {
    throw new Error('terminal artifact root ownership, mode, type, or link count is invalid');
  }
  const expectedDirectories = new Map((manifest.directories || []).map((record) => [
    record.path,
    record,
  ]));
  const actualDirectories = new Set();
  const actualFiles = new Set();
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error('terminal artifact metadata contains a symlink');
      if (stat.isDirectory()) {
        actualDirectories.add(relative);
        const record = expectedDirectories.get(relative);
        if (!record
            || !exactKeys(record, [
              'path', 'ownerUid', 'ownerGid', 'mode', 'linkCount',
            ])
            || record.ownerUid !== ownerUid || record.ownerGid !== ownerGid
            || record.mode !== publication.directoryMode
            || record.linkCount !== expectedDirectoryLinkCount(target)
            || stat.uid !== record.ownerUid || stat.gid !== record.ownerGid
            || modeString(stat.mode) !== record.mode || stat.nlink !== record.linkCount) {
          throw new Error(`terminal directory metadata mismatch: ${relative}`);
        }
        walk(target);
      } else if (stat.isFile()) {
        actualFiles.add(relative);
        if (stat.uid !== ownerUid || stat.gid !== ownerGid
            || modeString(stat.mode) !== publication.fileMode || stat.nlink !== 1) {
          throw new Error(`terminal file metadata mismatch: ${relative}`);
        }
      } else {
        throw new Error(`terminal artifact contains a special object: ${relative}`);
      }
    }
  };
  walk(root);
  const declaredFiles = new Set((manifest.files || []).map((record) => record.path));
  declaredFiles.add('artifact-manifest.json');
  if (canonicalJson([...actualDirectories].sort())
      !== canonicalJson([...expectedDirectories.keys()].sort())
      || canonicalJson([...actualFiles].sort()) !== canonicalJson([...declaredFiles].sort())) {
    throw new Error('terminal artifact metadata does not cover the exact recursive set');
  }
  return true;
}

function canonicalTimestamp(timestamp) {
  const milliseconds = Date.parse(String(timestamp || ''));
  return Number.isFinite(milliseconds)
    && new Date(milliseconds).toISOString() === timestamp;
}

function executionInterval(job, startedAt, completedAt) {
  const interval = {
    jobDigest: digest(job),
    notBefore: job.notBefore,
    startedAt,
    completedAt,
    expiresAt: job.expiresAt,
  };
  return {
    ...interval,
    executionIntervalSha256: digest(interval),
    valid: canonicalTimestamp(startedAt)
      && canonicalTimestamp(completedAt)
      && canonicalTimestamp(job.notBefore)
      && canonicalTimestamp(job.expiresAt)
      && Date.parse(startedAt) >= Date.parse(job.notBefore)
      && Date.parse(completedAt) >= Date.parse(startedAt)
      && Date.parse(completedAt) <= Date.parse(job.expiresAt),
  };
}

export function validatePhdWorkerArtifact({
  jobPath,
  artifactRoot,
  checkoutRoot,
  expectedExecutionIdentity = {},
  requireTerminalMetadata = false,
  terminalOwnerUid = 0,
  terminalOwnerGid = 0,
} = {}) {
  if (!jobPath || !artifactRoot || !checkoutRoot
      || !/^[0-9a-f]{40}$/.test(String(expectedExecutionIdentity.productTree || ''))
      || Object.entries(expectedExecutionIdentity).some(([key, digest]) => (
        key !== 'productTree' && !/^[0-9a-f]{64}$/.test(String(digest || ''))
      ))) {
    throw new Error('usage: validate-phd-worker-artifact.mjs JOB ARTIFACT_ROOT with exact plan and closure identity');
  }
  const job = readRegular(path.resolve(jobPath));
  if (job.campaignDigest !== expectedExecutionIdentity.campaignDigest
      || job.deployment?.productTree !== expectedExecutionIdentity.productTree
      || job.deployment?.runtimeSha256 !== expectedExecutionIdentity.runtimeSha256
      || job.deployment?.closureSha256 !== expectedExecutionIdentity.closureSha256) {
    throw new Error('terminal worker job execution closure identity mismatch');
  }
  assertExecutionClosureAtRoot(job.deployment.executionClosure, checkoutRoot);
  const root = path.resolve(artifactRoot);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('artifact root is unsafe');
  const manifest = readRegular(path.join(root, 'artifact-manifest.json'));
  const summary = readRegular(path.join(root, 'worker-summary.json'));
  const storedJob = readRegular(path.join(root, 'job.json'));
  const interval = executionInterval(job, summary.startedAt, summary.completedAt);
  if (canonicalJson(storedJob) !== canonicalJson(job)
      || !validatePhdWorkerSummaryStatus(summary)
      || summary.jobId !== job.jobId
      || summary.campaignId !== job.campaignId
      || summary.jobDigest !== interval.jobDigest
      || summary.executor !== job.executor
      || summary.notBefore !== job.notBefore
      || summary.expiresAt !== job.expiresAt
      || summary.executionIntervalSha256 !== interval.executionIntervalSha256
      || summary.timingProvenance !== 'worker_observed_awaiting_execution_attestation'
      || summary.authority !== 'worker_evidence_only'
      || summary.canonicalStateMutated !== false
      || !interval.valid
      || !exactKeys(manifest, [
        'schemaVersion', 'jobId', 'campaignId', 'jobDigest',
        'jobControlPlaneSignature', 'deployment', 'executor', 'executionIdentity',
        'promptSha256', 'status', 'notBefore', 'startedAt', 'completedAt', 'expiresAt',
        'executionIntervalSha256', 'timingProvenance', 'outputSha256',
        'publication', 'directories', 'files', 'authority', 'truthBoundary',
      ])
      || manifest.schemaVersion !== 'cortex.learning_os.phd_worker_manifest.v3'
      || manifest.jobId !== job.jobId
      || manifest.campaignId !== job.campaignId
      || manifest.jobDigest !== interval.jobDigest
      || canonicalJson(manifest.jobControlPlaneSignature)
        !== canonicalJson(job.controlPlaneSignature)
      || canonicalJson(manifest.deployment) !== canonicalJson(job.deployment)
      || manifest.executor !== job.executor
      || canonicalJson(manifest.executionIdentity)
        !== canonicalJson(expectedExecutionIdentity)
      || canonicalJson(summary.executionIdentity)
        !== canonicalJson(expectedExecutionIdentity)
      || manifest.promptSha256 !== job.promptSha256
      || manifest.status !== summary.status
      || manifest.notBefore !== summary.notBefore
      || manifest.startedAt !== summary.startedAt
      || manifest.completedAt !== summary.completedAt
      || manifest.expiresAt !== summary.expiresAt
      || manifest.executionIntervalSha256 !== summary.executionIntervalSha256
      || manifest.timingProvenance !== summary.timingProvenance
      || manifest.outputSha256 !== summary.outputSha256
      || manifest.authority !== 'worker_evidence_only'
      || !exactKeys(job.controlPlaneSignature, ['algorithm', 'keyId', 'digest'])
      || job.controlPlaneSignature.algorithm !== 'hmac-sha256'
      || !/^[0-9a-f]{16}$/.test(String(job.controlPlaneSignature.keyId || ''))
      || !/^[0-9a-f]{64}$/.test(String(job.controlPlaneSignature.digest || ''))
      || sha256File(path.join(root, 'output.json')) !== summary.outputSha256) {
    throw new Error('terminal worker artifact identity, timing, or raw byte binding mismatch');
  }
  if (summary.status === 'candidate'
      && (job.executor || 'model_no_tools') === 'model_no_tools') {
    const call = readRegular(path.join(root, 'model-call.json'));
    const terminal = validatePhdModelCallTerminal({
      job,
      call,
      jobDigest: interval.jobDigest,
      executionIdentity: expectedExecutionIdentity,
      startedAt: summary.startedAt,
      completedAt: summary.completedAt,
      executionIntervalSha256: interval.executionIntervalSha256,
      outputBytes: fs.readFileSync(path.join(root, 'output.json')),
      rawEventLedgerBytes: fs.readFileSync(path.join(root, 'raw-events.ndjson')),
      rawStderrBytes: fs.readFileSync(path.join(root, 'stderr.raw')),
    });
    if (!terminal.ok) {
      throw new Error(`terminal model artifact contract mismatch: ${terminal.errors.join('; ')}`);
    }
  } else if (summary.status === 'candidate') {
    const execution = readRegular(path.join(root, 'execution-record.json'));
    if (!exactKeys(execution, [
      'schemaVersion', 'jobId', 'jobDigest', 'role', 'executor', 'sessionId',
      'descriptorSha256', 'idempotencyKey', 'executionIdentity',
      'dependencyBindings', 'notBefore', 'startedAt', 'completedAt', 'expiresAt',
      'executionIntervalSha256', 'outputSha256', 'authority',
      'canonicalStateMutated',
    ])
        || execution.schemaVersion !== 'cortex.learning_os.phd_inert_execution.v2'
        || execution.jobId !== job.jobId
        || execution.jobDigest !== interval.jobDigest
        || canonicalJson(execution.executionIdentity) !== canonicalJson(expectedExecutionIdentity)
        || execution.executor !== job.executor
        || execution.descriptorSha256 !== job.descriptorSha256
        || execution.idempotencyKey !== job.idempotencyKey
        || execution.outputSha256 !== summary.outputSha256
        || execution.notBefore !== job.notBefore
        || execution.startedAt !== summary.startedAt
        || execution.completedAt !== summary.completedAt
        || execution.expiresAt !== job.expiresAt
        || execution.executionIntervalSha256 !== interval.executionIntervalSha256
        || execution.authority !== 'worker_evidence_only'
        || execution.canonicalStateMutated !== false) {
      throw new Error('terminal inert artifact identity or output binding mismatch');
    }
    if (job.executor === 'authority_request_materialization'
        && job.role === 'research_review_request') {
      const requestBytes = fs.readFileSync(
        path.join(root, 'research-review-authority-request.json'),
      );
      const outputBytes = fs.readFileSync(path.join(root, 'output.json'));
      const parsed = parseResearchReviewAuthorityRequestBytes(requestBytes);
      const expected = createResearchReviewAuthorityRequest({
        job,
        candidateBinding: parsed.request.candidateBinding,
      });
      if (!requestBytes.equals(outputBytes)
          || !requestBytes.equals(serializeResearchReviewAuthorityRequest(expected))) {
        throw new Error('terminal research review request bytes or exact scope are invalid');
      }
    }
    if (job.executor === 'frozen_research_reproduction') {
      const request = readRegular(path.join(root, 'reproduction-authority-request.json'));
      const recordValidation = validateExecutionEvidenceRecord({
        core: request.executionEvidenceCore,
        executionEvidenceSha256: request.executionEvidenceSha256,
      });
      const outputFiles = Object.fromEntries(
        (request.executionEvidenceCore?.outputs?.files || []).map((record) => [
          record.path,
          fs.readFileSync(path.join(root, 'outputs', ...record.path.split('/'))),
        ]),
      );
      const bytesValidation = recordValidation.ok
        ? verifyExecutionEvidenceBytes(request.executionEvidenceCore, {
          inputBytes: Buffer.from(canonicalJson(job.task.sourceBundle), 'utf8'),
          rawOutputs: {
            stdout: fs.readFileSync(path.join(root, 'stdout.raw')),
            stderr: fs.readFileSync(path.join(root, 'stderr.raw')),
          },
          outputFiles,
        })
        : recordValidation;
      if (request.status !== 'ready_for_independent_authority'
          || !recordValidation.ok
          || !bytesValidation.ok
          || request.requestedAttestationPayload?.executionEvidenceSha256
            !== request.executionEvidenceSha256
          || canonicalJson(request.requestedAttestationPayload?.executionEvidenceCore)
            !== canonicalJson(request.executionEvidenceCore)
          || request.executionEvidenceCore.bindings.jobId !== job.jobId
          || request.executionEvidenceCore.bindings.jobSha256
            !== sha256Text(canonicalJson(job))
          || request.executionEvidenceCore.bindings.campaignId !== job.campaignId
          || request.executionEvidenceCore.bindings.campaignSha256 !== job.campaignDigest
          || request.executionEvidenceCore.bindings.deploymentSha256
            !== deploymentBindingDigest(job.deployment)
          || request.executionEvidenceCore.bindings.sourceSha256
            !== job.task.sourceBundleSha256) {
        throw new Error('terminal reproduction execution-evidence core is invalid or detached');
      }
    }
  }
  const expected = new Set();
  for (const row of manifest.files || []) {
    if (!exactKeys(row, [
      'path', 'bytes', 'ownerUid', 'ownerGid', 'mode', 'linkCount', 'sha256',
    ])
        || typeof row.path !== 'string'
        || !Number.isSafeInteger(row.bytes) || row.bytes < 0
        || row.ownerUid !== 0 || row.ownerGid !== 0
        || row.mode !== '0444' || row.linkCount !== 1
        || !/^[0-9a-f]{64}$/.test(String(row.sha256 || ''))
        || path.isAbsolute(row.path) || row.path.split('/').includes('..')
        || expected.has(row.path)) throw new Error('manifest path is unsafe or duplicated');
    const target = path.resolve(root, row.path);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error('manifest path escapes artifact root');
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== row.bytes || sha256File(target) !== row.sha256) {
      throw new Error(`manifested file mismatch: ${row.path}`);
    }
    expected.add(row.path);
  }
  const actual = new Set();
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('terminal artifact contains a symlink');
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile() && entry.name !== 'artifact-manifest.json') {
        actual.add(path.relative(root, target));
      }
    }
  };
  walk(root);
  if (canonicalJson([...expected].sort()) !== canonicalJson([...actual].sort())) {
    throw new Error('manifest does not exactly cover terminal artifact');
  }
  const directoryPaths = [];
  for (const row of manifest.directories || []) {
    if (!exactKeys(row, ['path', 'ownerUid', 'ownerGid', 'mode', 'linkCount'])
        || typeof row.path !== 'string' || row.path.length < 1
        || path.isAbsolute(row.path) || row.path.split('/').includes('..')
        || row.ownerUid !== 0 || row.ownerGid !== 0 || row.mode !== '0555'
        || !Number.isSafeInteger(row.linkCount) || row.linkCount < 2
        || directoryPaths.includes(row.path)) {
      throw new Error('manifest directory metadata is unsafe or duplicated');
    }
    directoryPaths.push(row.path);
  }
  const actualDirectories = [];
  const walkDirectories = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      actualDirectories.push(path.relative(root, target));
      walkDirectories(target);
    }
  };
  walkDirectories(root);
  if (canonicalJson([...directoryPaths].sort()) !== canonicalJson(actualDirectories.sort())) {
    throw new Error('manifest does not exactly cover terminal directories');
  }
  if (requireTerminalMetadata) {
    validateTerminalArtifactMetadata(root, manifest, {
      ownerUid: terminalOwnerUid,
      ownerGid: terminalOwnerGid,
    });
  }
  return {
    valid: true,
    jobId: job.jobId,
    status: summary.status,
    executionIntervalSha256: interval.executionIntervalSha256,
  };
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const argumentsList = process.argv.slice(2);
  const [jobPath, artifactRoot] = argumentsList;
  const value = (flag) => {
    const index = argumentsList.indexOf(flag);
    return index >= 0 && index + 1 < argumentsList.length ? argumentsList[index + 1] : null;
  };
  try {
    validatePhdWorkerArtifact({
      jobPath,
      artifactRoot,
      checkoutRoot: value('--checkout-root'),
      expectedExecutionIdentity: {
        planDigest: value('--plan-digest'),
        campaignDigest: value('--campaign-digest'),
        descriptorSetSha256: value('--descriptor-set-sha256'),
        productTree: value('--product-tree'),
        runtimeSha256: value('--runtime-sha256'),
        closureSha256: value('--closure-sha256'),
      },
      requireTerminalMetadata: argumentsList.includes('--require-terminal-metadata'),
      terminalOwnerUid: Number(value('--terminal-owner-uid') || 0),
      terminalOwnerGid: Number(value('--terminal-owner-gid') || 0),
    });
    process.stdout.write('valid\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
