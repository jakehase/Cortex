#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { assertApprovedModelExecutableAtPath } from './approved-model-executable.mjs';
import { assertApprovedResearchRuntimeAtPath } from './approved-research-runtime.mjs';
import {
  assertAuthorityBindings,
  readAuthorityJson,
  readAuthoritySecret,
  validateAuthorityExpectations,
} from './authority-input.mjs';
import {
  deploymentBindingDigest,
  isModelExecutableDeploymentBinding,
} from './deployment-identity.mjs';
import { assertExecutionClosureAtRoot } from './git-product-source.mjs';
import { linuxDescriptorMountId } from './linux-descriptor-identity.mjs';
import { assertDetachedQualificationJobPlan } from './phd-campaign.mjs';
import { sha256Bytes, sha256Text } from './hash.mjs';

const DIGEST = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const DIRECTORY_FLAGS = fs.constants.O_RDONLY
  | (fs.constants.O_DIRECTORY || 0)
  | (fs.constants.O_NOFOLLOW || 0)
  | (fs.constants.O_CLOEXEC || 0);
const FILE_FLAGS = fs.constants.O_RDONLY
  | (fs.constants.O_NOFOLLOW || 0)
  | (fs.constants.O_NONBLOCK || 0)
  | (fs.constants.O_CLOEXEC || 0);

function readRegularJson(target, label, {
  ownerOnly = false,
  consume = null,
} = {}) {
  const snapshot = readAuthorityJson(target, label, {
    allowedModes: ownerOnly ? [0o400, 0o600] : [0o400, 0o444, 0o600],
    consume,
  });
  return {
    record: snapshot.record,
    consumed: snapshot.consumed,
    bytes: snapshot.bytes,
    resolved: snapshot.path,
  };
}

function readOwnerSecret(target, expectedKeyId) {
  return readAuthoritySecret(target, {
    label: 'qualification secret',
    expectedKeyId,
  }).secret;
}

function descriptorEntry(descriptor, name) {
  return `/proc/self/fd/${descriptor}/${name}`;
}

function outputDirectoryIdentity(descriptor) {
  const stat = fs.fstatSync(descriptor, { bigint: true });
  return {
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode,
    nlink: stat.nlink,
    mountId: linuxDescriptorMountId(descriptor),
  };
}

function sameOutputDirectoryIdentity(left, right) {
  return Object.keys(left).every((field) => left[field] === right[field]);
}

function safeOutputAncestor(stat, filesystemUid, ownerUid) {
  const stickyWorldWritable = (stat.mode & 0o1000n) !== 0n
    && (stat.mode & 0o002n) !== 0n;
  return stat.isDirectory()
    && stat.nlink > 0n
    && [filesystemUid, ownerUid].includes(stat.uid)
    && ((stat.mode & 0o022n) === 0n
      || (stickyWorldWritable && stat.uid === filesystemUid));
}

function openOwnerOnlyOutputParent(parentPath, owner, { create = false } = {}) {
  const resolved = path.resolve(parentPath);
  const root = path.parse(resolved).root;
  const components = resolved.slice(root.length).split(path.sep).filter(Boolean);
  let descriptor = fs.openSync(root, DIRECTORY_FLAGS);
  let traversed = root;
  const chain = [];
  try {
    const filesystemUid = fs.fstatSync(descriptor, { bigint: true }).uid;
    const retain = () => {
      const stat = fs.fstatSync(descriptor, { bigint: true });
      if (!safeOutputAncestor(stat, filesystemUid, owner.uid)) {
        throw new Error(
          `qualification publication ancestor is unsafe: ${traversed}`,
        );
      }
      chain.push({
        descriptor,
        identity: outputDirectoryIdentity(descriptor),
        path: traversed,
      });
    };
    retain();
    for (const component of components) {
      const view = descriptorEntry(descriptor, component);
      let child;
      let created = false;
      try {
        child = fs.openSync(view, DIRECTORY_FLAGS);
      } catch (error) {
        if (error.code !== 'ENOENT' || create !== true) throw error;
        try {
          fs.mkdirSync(view, { mode: 0o700 });
          fs.fsyncSync(descriptor);
          created = true;
        } catch (mkdirError) {
          if (mkdirError.code !== 'EEXIST') throw mkdirError;
        }
        child = fs.openSync(view, DIRECTORY_FLAGS);
      }
      if (created) {
        const prior = chain.at(-1).identity;
        const refreshed = outputDirectoryIdentity(descriptor);
        const stableFields = [
          'dev', 'ino', 'uid', 'gid', 'mode', 'mountId',
        ];
        if (stableFields.some((field) => prior[field] !== refreshed[field])
            || refreshed.nlink !== prior.nlink + 1n) {
          fs.closeSync(child);
          throw new Error(
            `qualification publication ancestor changed during directory creation: ${traversed}`,
          );
        }
        chain.at(-1).identity = refreshed;
      }
      descriptor = child;
      traversed = path.join(traversed, component);
      retain();
    }
    const parent = fs.fstatSync(descriptor, { bigint: true });
    if (!parent.isDirectory()
        || parent.nlink < 1n
        || parent.uid !== owner.uid
        || parent.gid !== owner.gid
        || (parent.mode & 0o7777n) !== 0o700n) {
      throw new Error(
        'qualification publication parent must be an owner-only directory',
      );
    }
    return {
      chain,
      components,
      descriptor,
      filesystemUid,
      identity: chain.at(-1).identity,
      path: resolved,
      root,
    };
  } catch (error) {
    if (!chain.some((entry) => entry.descriptor === descriptor)) {
      fs.closeSync(descriptor);
    }
    for (const entry of chain.reverse()) fs.closeSync(entry.descriptor);
    if (['ELOOP', 'ENOTDIR'].includes(error.code)) {
      throw new Error(
        `qualification publication ancestor is not a no-follow directory: ${traversed}`,
        { cause: error },
      );
    }
    throw error;
  }
}

function closeOutputParent(handle) {
  for (const entry of [...handle.chain].reverse()) {
    fs.closeSync(entry.descriptor);
  }
}

function assertNamedOutputParent(handle, owner) {
  let descriptor = fs.openSync(handle.root, DIRECTORY_FLAGS);
  let traversed = handle.root;
  try {
    for (let index = 0; index < handle.chain.length; index += 1) {
      const retained = handle.chain[index];
      const retainedStat = fs.fstatSync(retained.descriptor, { bigint: true });
      const namedStat = fs.fstatSync(descriptor, { bigint: true });
      const retainedIdentity = outputDirectoryIdentity(retained.descriptor);
      const namedIdentity = outputDirectoryIdentity(descriptor);
      if (!safeOutputAncestor(
        retainedStat,
        handle.filesystemUid,
        owner.uid,
      )
          || !safeOutputAncestor(
            namedStat,
            handle.filesystemUid,
            owner.uid,
          )
          || !sameOutputDirectoryIdentity(
            retainedIdentity,
            retained.identity,
          )
          || !sameOutputDirectoryIdentity(namedIdentity, retained.identity)) {
        throw new Error(
          `qualification publication parent identity changed: ${traversed}`,
        );
      }
      if (index === handle.components.length) {
        if (namedStat.uid !== owner.uid
            || namedStat.gid !== owner.gid
            || (namedStat.mode & 0o7777n) !== 0o700n) {
          throw new Error(
            'qualification publication parent lost its owner-only identity',
          );
        }
        break;
      }
      const child = fs.openSync(
        descriptorEntry(descriptor, handle.components[index]),
        DIRECTORY_FLAGS,
      );
      fs.closeSync(descriptor);
      descriptor = child;
      traversed = path.join(traversed, handle.components[index]);
    }
  } catch (error) {
    if (/^qualification publication parent/.test(String(error.message))) {
      throw error;
    }
    throw new Error(
      `qualification publication parent identity changed: ${traversed}`,
      { cause: error },
    );
  } finally {
    fs.closeSync(descriptor);
  }
}

function readExactDescriptorBytes(descriptor, expectedLength) {
  const bytes = Buffer.alloc(expectedLength);
  let offset = 0;
  while (offset < expectedLength) {
    const count = fs.readSync(
      descriptor,
      bytes,
      offset,
      expectedLength - offset,
      offset,
    );
    if (count === 0) break;
    offset += count;
  }
  const extra = Buffer.alloc(1);
  const extraLength = fs.readSync(
    descriptor,
    extra,
    0,
    1,
    expectedLength,
  );
  return offset === expectedLength && extraLength === 0 ? bytes : null;
}

function sameOutputIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.birthtimeNs === right.birthtimeNs;
}

function exactOutputAt(
  parentDescriptor,
  parentMountId,
  name,
  expectedBytes,
  owner,
  label,
) {
  let descriptor = null;
  let namedDescriptor = null;
  try {
    descriptor = fs.openSync(
      descriptorEntry(parentDescriptor, name),
      FILE_FLAGS,
    );
    const before = fs.fstatSync(descriptor, { bigint: true });
    const beforeMountId = linuxDescriptorMountId(descriptor);
    if (!before.isFile()
        || before.dev !== fs.fstatSync(parentDescriptor, { bigint: true }).dev
        || beforeMountId !== parentMountId
        || before.uid !== owner.uid
        || before.gid !== owner.gid
        || (before.mode & 0o7777n) !== 0o600n
        || before.nlink !== 1n
        || before.size !== BigInt(expectedBytes.length)) {
      throw new Error(`existing ${label} is unsafe or differs from authenticated bytes`);
    }
    const bytes = readExactDescriptorBytes(descriptor, expectedBytes.length);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const afterMountId = linuxDescriptorMountId(descriptor);
    namedDescriptor = fs.openSync(
      descriptorEntry(parentDescriptor, name),
      FILE_FLAGS,
    );
    const named = fs.fstatSync(namedDescriptor, { bigint: true });
    const namedMountId = linuxDescriptorMountId(namedDescriptor);
    const committedBytes = readExactDescriptorBytes(
      descriptor,
      expectedBytes.length,
    );
    fs.fsyncSync(descriptor);
    const committed = fs.fstatSync(descriptor, { bigint: true });
    const committedMountId = linuxDescriptorMountId(descriptor);
    if (bytes === null
        || committedBytes === null
        || !bytes.equals(expectedBytes)
        || !committedBytes.equals(expectedBytes)
        || beforeMountId !== afterMountId
        || afterMountId !== namedMountId
        || namedMountId !== committedMountId
        || !sameOutputIdentity(before, after)
        || !sameOutputIdentity(after, named)
        || !sameOutputIdentity(named, committed)) {
      throw new Error(`existing ${label} is unsafe or differs from authenticated bytes`);
    }
    return true;
  } finally {
    if (namedDescriptor !== null) fs.closeSync(namedDescriptor);
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function reconcileOutputStages(
  parentDescriptor,
  targetName,
  expectedBytes,
  owner,
  label,
  parentMountId,
) {
  const prefix = `.${targetName}.publish-`;
  const pattern = new RegExp(
    `^[.]${targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.]publish-[0-9a-f]{32}[.]tmp$`,
  );
  for (const name of fs.readdirSync(`/proc/self/fd/${parentDescriptor}`).sort()) {
    if (!name.startsWith(prefix)) continue;
    if (!pattern.test(name)) {
      throw new Error(`${label} crash stage name is unsafe`);
    }
    let descriptor = null;
    let targetDescriptor = null;
    try {
      descriptor = fs.openSync(
        descriptorEntry(parentDescriptor, name),
        FILE_FLAGS,
      );
      const stat = fs.fstatSync(descriptor, { bigint: true });
      const stageMountId = linuxDescriptorMountId(descriptor);
      if (!stat.isFile()
          || stageMountId !== parentMountId
          || stat.uid !== owner.uid
          || stat.gid !== owner.gid
          || (stat.mode & 0o7777n) !== 0o600n
          || ![1n, 2n].includes(stat.nlink)
          || stat.size > BigInt(expectedBytes.length)) {
        throw new Error(`${label} crash stage is unsafe`);
      }
      if (stat.nlink === 2n) {
        targetDescriptor = fs.openSync(
          descriptorEntry(parentDescriptor, targetName),
          FILE_FLAGS,
        );
        const target = fs.fstatSync(targetDescriptor, { bigint: true });
        const targetMountId = linuxDescriptorMountId(targetDescriptor);
        const bytes = readExactDescriptorBytes(
          descriptor,
          expectedBytes.length,
        );
        if (target.dev !== stat.dev
            || target.ino !== stat.ino
            || targetMountId !== stageMountId
            || stat.size !== BigInt(expectedBytes.length)
            || bytes === null
            || !bytes.equals(expectedBytes)) {
          throw new Error(`${label} linked crash stage is not the exact publication`);
        }
        fs.fsyncSync(targetDescriptor);
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`${label} linked crash stage lost its committed target`, {
          cause: error,
        });
      }
      throw error;
    } finally {
      if (targetDescriptor !== null) fs.closeSync(targetDescriptor);
      if (descriptor !== null) fs.closeSync(descriptor);
    }
    fs.unlinkSync(descriptorEntry(parentDescriptor, name));
    fs.fsyncSync(parentDescriptor);
  }
}

function atomicWriteBytes(
  target,
  bytes,
  label,
  { createParent = false } = {},
) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 64 * 1024 * 1024) {
    throw new Error(`${label} bytes are absent or oversized`);
  }
  if (process.platform !== 'linux'
      || typeof process.geteuid !== 'function'
      || typeof process.getegid !== 'function'
      || !fs.existsSync('/proc/self/fd')) {
    throw new Error(`${label} publication requires Linux descriptor-relative I/O`);
  }
  const resolved = path.resolve(target);
  const parent = path.dirname(resolved);
  const targetName = path.basename(resolved);
  if (targetName === '.' || targetName === '..'
      || /[\x00-\x1f\x7f/]/.test(targetName)) {
    throw new Error(`${label} target name is unsafe`);
  }
  const owner = {
    uid: BigInt(process.geteuid()),
    gid: BigInt(process.getegid()),
  };
  const parentHandle = openOwnerOnlyOutputParent(parent, owner, {
    create: createParent,
  });
  const parentDescriptor = parentHandle.descriptor;
  try {
    const parentBefore = fs.fstatSync(parentDescriptor, { bigint: true });
    assertNamedOutputParent(parentHandle, owner);
    reconcileOutputStages(
      parentDescriptor,
      targetName,
      bytes,
      owner,
      label,
      parentHandle.identity.mountId,
    );
    try {
      exactOutputAt(
        parentDescriptor,
        parentHandle.identity.mountId,
        targetName,
        bytes,
        owner,
        label,
      );
      fs.fsyncSync(parentDescriptor);
      assertNamedOutputParent(parentHandle, owner);
      return resolved;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const stageName = `.${targetName}.publish-${
      crypto.randomBytes(16).toString('hex')
    }.tmp`;
    const stageView = descriptorEntry(parentDescriptor, stageName);
    let stageDescriptor = fs.openSync(
      stageView,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY
        | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_CLOEXEC || 0),
      0o600,
    );
    try {
      fs.writeFileSync(stageDescriptor, bytes);
      fs.fchmodSync(stageDescriptor, 0o600);
      fs.fsyncSync(stageDescriptor);
    } finally {
      fs.closeSync(stageDescriptor);
      stageDescriptor = null;
    }
    fs.fsyncSync(parentDescriptor);
    try {
      fs.linkSync(
        stageView,
        descriptorEntry(parentDescriptor, targetName),
      );
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    fs.fsyncSync(parentDescriptor);
    fs.unlinkSync(stageView);
    fs.fsyncSync(parentDescriptor);
    exactOutputAt(
      parentDescriptor,
      parentHandle.identity.mountId,
      targetName,
      bytes,
      owner,
      label,
    );
    const parentAfter = fs.fstatSync(parentDescriptor, { bigint: true });
    if (parentAfter.dev !== parentBefore.dev
        || parentAfter.ino !== parentBefore.ino
        || parentAfter.uid !== parentBefore.uid
        || parentAfter.gid !== parentBefore.gid
        || parentAfter.mode !== parentBefore.mode
        || parentAfter.nlink !== parentBefore.nlink) {
      throw new Error(`${label} parent identity changed during publication`);
    }
    if (linuxDescriptorMountId(parentDescriptor)
          !== parentHandle.identity.mountId) {
      throw new Error(`${label} parent mount identity changed during publication`);
    }
    assertNamedOutputParent(parentHandle, owner);
    return resolved;
  } finally {
    closeOutputParent(parentHandle);
  }
}

function atomicWriteJob(target, job) {
  const resolved = path.resolve(target);
  const bytes = Buffer.from(`${JSON.stringify(job, null, 2)}\n`, 'utf8');
  return atomicWriteBytes(
    resolved,
    bytes,
    'materialized qualification job',
    { createParent: true },
  );
}

export function verifyQualificationLaunchPlan({
  plan,
  signingSecret,
  expectedSubjectId = null,
  expectedCampaignId = null,
  expectedCampaignDigest = null,
  expectedDeployment = null,
  expectedDeploymentDigest = null,
  expectedPlanDigest = null,
  expectedDescriptorSetSha256 = null,
  expectedJobCount = null,
  expectedJobSetSha256 = null,
  now = new Date().toISOString(),
  authorization = 'launch',
} = {}) {
  assertDetachedQualificationJobPlan(plan, signingSecret, {
    expectedCampaignId,
    expectedDeployment,
    now,
    authorization,
  });
  if (expectedSubjectId !== null && plan.subjectId !== expectedSubjectId) {
    throw new Error('qualification subject identity mismatch');
  }
  const planDigest = sha256Text(canonicalJson(plan));
  const deploymentDigest = deploymentBindingDigest(plan.deployment);
  const jobIds = plan.jobs.map((job) => job.jobId);
  const jobSetSha256 = sha256Text(canonicalJson(jobIds));
  for (const [label, expected, observed] of [
    ['plan digest', expectedPlanDigest, planDigest],
    ['campaign digest', expectedCampaignDigest, plan.campaignDigest],
    ['deployment digest', expectedDeploymentDigest, deploymentDigest],
    ['descriptor set digest', expectedDescriptorSetSha256, plan.descriptorSetSha256],
    ['job set digest', expectedJobSetSha256, jobSetSha256],
  ]) {
    if (expected !== null && (!DIGEST.test(String(expected || '')) || expected !== observed)) {
      throw new Error(`qualification ${label} mismatch`);
    }
  }
  if (expectedJobCount !== null
      && (!Number.isInteger(expectedJobCount) || expectedJobCount !== jobIds.length)) {
    throw new Error('qualification expected job count mismatch');
  }
  return {
    schemaVersion: 'cortex.learning_os.phd_qualification_launch_verification.v1',
    planDigest,
    campaignId: plan.campaignId,
    subjectId: plan.subjectId,
    campaignDigest: plan.campaignDigest,
    deploymentDigest,
    sourceCommit: plan.deployment.sourceCommit,
    sourceTree: plan.deployment.sourceTree,
    productTree: plan.deployment.productTree,
    runtimeSha256: plan.deployment.runtimeSha256,
    closureSha256: plan.deployment.closureSha256,
    approvedModelExecutable: structuredClone(
      plan.deployment.approvedModelExecutable || null,
    ),
    approvedResearchRuntime: structuredClone(
      plan.deployment.approvedResearchRuntime || null,
    ),
    descriptorSetSha256: plan.descriptorSetSha256,
    expiresAt: plan.expiresAt,
    jobCount: jobIds.length,
    jobIds,
    jobSetSha256,
    jobDigests: Object.fromEntries(plan.jobs.map((job) => [
      job.jobId,
      sha256Text(canonicalJson(job)),
    ])),
    authenticated: true,
    truthBoundary: authorization === 'launch'
      ? 'This verification authenticates launch authorization only; it is not job output or qualification evidence.'
      : 'This archival verification authenticates an expired plan for read-only terminal collection only; it cannot authorize launch or materialization.',
  };
}

export function snapshotAuthenticatedQualificationPlan({
  plan,
  planBytes,
  signingSecret,
  expectedPlanDigest,
  expectedCampaignId,
  out,
  now = new Date().toISOString(),
} = {}) {
  const verification = verifyQualificationLaunchPlan({
    plan,
    signingSecret,
    expectedPlanDigest,
    expectedCampaignId,
    now,
  });
  if (!Buffer.isBuffer(planBytes) || planBytes.length < 2
      || canonicalJson(JSON.parse(planBytes.toString('utf8'))) !== canonicalJson(plan)) {
    throw new Error('qualification plan snapshot bytes do not encode the authenticated plan');
  }
  const output = atomicWriteBytes(out, planBytes, 'qualification plan snapshot');
  return {
    ...verification,
    snapshotPath: output,
    // The receipt authenticates the already-pinned input bytes that were
    // published. Reopening the output pathname here would create a new,
    // unprotected observation after the publication handoff and could let a
    // close-triggered name substitution change the digest we report.
    snapshotFileSha256: sha256Bytes(planBytes),
    ownerOnly: true,
  };
}

export function verifyQualificationExecutionCheckout({
  plan,
  signingSecret,
  checkoutRoot,
  expectedPlanDigest,
  expectedCampaignId,
  expectedCampaignDigest = null,
  expectedDeploymentDigest = null,
  expectedDescriptorSetSha256 = null,
  expectedJobCount = null,
  expectedJobSetSha256 = null,
  now = new Date().toISOString(),
  authorization = 'launch',
} = {}) {
  const verification = verifyQualificationLaunchPlan({
    plan,
    signingSecret,
    expectedPlanDigest,
    expectedCampaignId,
    expectedCampaignDigest,
    expectedDeploymentDigest,
    expectedDescriptorSetSha256,
    expectedJobCount,
    expectedJobSetSha256,
    now,
    authorization,
  });
  assertExecutionClosureAtRoot(plan.deployment.executionClosure, checkoutRoot);
  return {
    ...verification,
    checkoutRoot: path.resolve(checkoutRoot),
    immutableExecutionClosureVerified: true,
  };
}

export function verifyQualificationHarvestCheckout(options = {}) {
  return verifyQualificationExecutionCheckout({
    ...options,
    authorization: 'archival_harvest',
  });
}

export function verifyExistingQualificationJob({
  plan,
  signingSecret,
  jobBytes,
  job,
  jobId,
  expectedPlanDigest,
  now = new Date().toISOString(),
} = {}) {
  const verification = verifyQualificationLaunchPlan({
    plan,
    signingSecret,
    expectedPlanDigest,
    now,
    authorization: 'archival_harvest',
  });
  const expectedJob = plan.jobs.find((candidate) => candidate.jobId === jobId);
  const expectedBytes = expectedJob === undefined
    ? null
    : Buffer.from(`${JSON.stringify(expectedJob, null, 2)}\n`, 'utf8');
  if (expectedJob === undefined
      || !Buffer.isBuffer(jobBytes)
      || !jobBytes.equals(expectedBytes)
      || canonicalJson(job) !== canonicalJson(expectedJob)) {
    throw new Error('existing qualification job is absent or differs from exact authenticated bytes');
  }
  return {
    ...verification,
    jobId,
    jobFileSha256: sha256Bytes(jobBytes),
    exactExistingJobBytesVerified: true,
    truthBoundary: 'This archival check authenticates one already-published job byte sequence; it cannot materialize or dispatch work.',
  };
}

export function verifyQualificationExecutionClosureSnapshot({
  plan,
  expectedPlanDigest,
  checkoutRoot,
} = {}) {
  if (plan?.schemaVersion !== 'cortex.learning_os.phd_detached_job_plan.v2'
      || !DIGEST.test(String(expectedPlanDigest || ''))
      || sha256Text(canonicalJson(plan)) !== expectedPlanDigest
      || plan?.deployment?.executionClosure?.immutable !== true) {
    throw new Error('qualification closure snapshot is not the exact immutable authenticated plan');
  }
  assertExecutionClosureAtRoot(plan.deployment.executionClosure, checkoutRoot);
  return {
    schemaVersion: 'cortex.learning_os.phd_qualification_closure_verification.v1',
    planDigest: expectedPlanDigest,
    campaignId: plan.campaignId,
    checkoutRoot: path.resolve(checkoutRoot),
    closureSha256: plan.deployment.closureSha256,
    immutableExecutionClosureVerified: true,
  };
}

export function verifyQualificationApprovedModelExecutable({
  plan,
  expectedPlanDigest,
} = {}) {
  if (plan?.schemaVersion !== 'cortex.learning_os.phd_detached_job_plan.v2'
      || !DIGEST.test(String(expectedPlanDigest || ''))
      || sha256Text(canonicalJson(plan)) !== expectedPlanDigest
      || !isModelExecutableDeploymentBinding(plan?.deployment)) {
    throw new Error('qualification plan does not bind the exact approved model executable');
  }
  assertApprovedModelExecutableAtPath(plan.deployment.approvedModelExecutable);
  if (plan.deployment.approvedResearchRuntime !== undefined) {
    assertApprovedResearchRuntimeAtPath(plan.deployment.approvedResearchRuntime);
  }
  return {
    schemaVersion: 'cortex.learning_os.phd_approved_model_executable_verification.v1',
    planDigest: expectedPlanDigest,
    campaignId: plan.campaignId,
    approvedModelExecutable: structuredClone(plan.deployment.approvedModelExecutable),
    approvedResearchRuntime: plan.deployment.approvedResearchRuntime === undefined
      ? null
      : structuredClone(plan.deployment.approvedResearchRuntime),
    immutableRuntimeClosureVerified: true,
    raceFreeExecutionRequired: {
      model: '/proc/self/fd/3',
      researchRuntime: plan.deployment.approvedResearchRuntime === undefined
        ? null
        : '/proc/self/fd/4',
    },
  };
}

export function materializeAuthenticatedQualificationJob({
  plan,
  signingSecret,
  planDigest,
  jobId,
  out,
  now = new Date().toISOString(),
} = {}) {
  const verification = verifyQualificationLaunchPlan({ plan, signingSecret, now });
  if (!DIGEST.test(String(planDigest || '')) || verification.planDigest !== planDigest) {
    throw new Error('qualification plan changed after launch verification');
  }
  if (!ID.test(String(jobId || ''))) throw new Error('invalid qualification job identity');
  const job = plan.jobs.find((candidate) => candidate.jobId === jobId);
  if (!job) throw new Error('qualification job is absent from the authenticated plan');
  const jobBytes = Buffer.from(`${JSON.stringify(job, null, 2)}\n`, 'utf8');
  const output = atomicWriteJob(out, job);
  return {
    schemaVersion: 'cortex.learning_os.phd_qualification_job_materialization.v1',
    planDigest,
    jobId,
    jobDigest: verification.jobDigests[jobId],
    // Bind the materialization receipt to the exact signed-plan bytes, not to
    // a pathname reopened after atomic publication has released its pins.
    jobFileSha256: sha256Bytes(jobBytes),
    output,
    authenticated: true,
    truthBoundary: 'This exact signed job is authorized for detached candidate execution only.',
  };
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  const args = process.argv.slice(2);
  const command = args[0];
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
  };
  try {
    if (!['verify-plan', 'verify-harvest-plan', 'snapshot-plan', 'verify-checkout', 'verify-harvest-checkout', 'verify-closure', 'verify-executable', 'verify-existing-job', 'materialize-job'].includes(command)) {
      throw new Error('expected verify-plan, verify-harvest-plan, snapshot-plan, verify-checkout, verify-harvest-checkout, verify-closure, verify-executable, verify-existing-job, or materialize-job');
    }
    const planPath = value('--plan');
    const secretPath = value('--secret');
    const digestBoundOnly = ['verify-closure', 'verify-executable'].includes(command);
    if (!planPath || (!digestBoundOnly && !secretPath)) {
      throw new Error('--plan and, except for digest-bound closure/executable verification, --secret are required');
    }
    const expectedAuthority = digestBoundOnly
      ? null
      : validateAuthorityExpectations({
        subjectId: value('--expected-subject-id'),
        campaignDigest: value('--expected-campaign-digest'),
        deploymentDigest: value('--expected-deployment-digest'),
        keyId: value('--expected-key-id'),
      });
    const expectedCampaignId = value('--expected-campaign-id');
    if (!digestBoundOnly && !ID.test(String(expectedCampaignId || ''))) {
      throw new Error('independently configured campaign ID is required');
    }
    const signingSecret = digestBoundOnly
      ? null
      : readOwnerSecret(secretPath, expectedAuthority.keyId);
    const now = value('--now') || new Date().toISOString();
    const expectedJobCountValue = value('--expected-job-count');
    const protectedVerificationOptions = {
      signingSecret,
      expectedSubjectId: value('--expected-subject-id'),
      expectedCampaignId,
      expectedCampaignDigest: value('--expected-campaign-digest'),
      expectedDeploymentDigest: value('--expected-deployment-digest'),
      expectedPlanDigest: value('--expected-plan-digest'),
      expectedDescriptorSetSha256: value('--expected-descriptor-set-sha256'),
      expectedJobCount: expectedJobCountValue === null
        ? null
        : Number(expectedJobCountValue),
      expectedJobSetSha256: value('--expected-job-set-sha256'),
      now,
    };
    const loaded = readRegularJson(planPath, 'qualification plan', {
      ownerOnly: !digestBoundOnly,
      consume: digestBoundOnly
        ? null
        : (candidate) => {
          assertAuthorityBindings({
            subjectId: candidate.subjectId,
            campaignDigest: candidate.campaignDigest,
            deploymentDigest: deploymentBindingDigest(candidate.deployment),
            keyId: candidate.controlPlaneSignature?.keyId,
          }, expectedAuthority, 'qualification plan');
          if (candidate.campaignId !== expectedCampaignId) {
            throw new Error(
              'qualification plan differs from the independently configured campaign ID',
            );
          }
          verifyQualificationLaunchPlan({
            ...protectedVerificationOptions,
            plan: candidate,
            authorization: [
              'verify-harvest-plan',
              'verify-harvest-checkout',
              'verify-existing-job',
            ].includes(command)
              ? 'archival_harvest'
              : 'launch',
          });
          return candidate;
        },
    });
    const plan = digestBoundOnly ? loaded.record : loaded.consumed;
    const verificationOptions = {
      plan,
      ...protectedVerificationOptions,
    };
    const result = command === 'verify-closure'
      ? verifyQualificationExecutionClosureSnapshot({
        plan,
        expectedPlanDigest: value('--expected-plan-digest'),
        checkoutRoot: value('--checkout-root'),
      })
      : command === 'verify-executable'
        ? verifyQualificationApprovedModelExecutable({
          plan,
          expectedPlanDigest: value('--expected-plan-digest'),
        })
      : ['verify-plan', 'verify-harvest-plan'].includes(command)
      ? verifyQualificationLaunchPlan({
        ...verificationOptions,
        authorization: command === 'verify-harvest-plan' ? 'archival_harvest' : 'launch',
      })
      : command === 'snapshot-plan'
        ? snapshotAuthenticatedQualificationPlan({
          plan,
          planBytes: loaded.bytes,
          signingSecret,
          expectedPlanDigest: value('--expected-plan-digest'),
          expectedCampaignId: value('--expected-campaign-id'),
          out: value('--out'),
          now,
        })
        : ['verify-checkout', 'verify-harvest-checkout'].includes(command)
          ? verifyQualificationExecutionCheckout({
            ...verificationOptions,
            checkoutRoot: value('--checkout-root'),
            authorization: command === 'verify-harvest-checkout'
              ? 'archival_harvest'
              : 'launch',
          })
          : command === 'verify-existing-job'
            ? (() => {
              const loadedJob = readRegularJson(value('--job'), 'existing qualification job');
              return verifyExistingQualificationJob({
                plan,
                signingSecret,
                jobBytes: loadedJob.bytes,
                job: loadedJob.record,
                jobId: value('--job-id'),
                expectedPlanDigest: value('--expected-plan-digest'),
                now,
              });
            })()
      : materializeAuthenticatedQualificationJob({
        plan,
        signingSecret,
        planDigest: value('--plan-digest'),
        jobId: value('--job-id'),
        out: value('--out'),
        now,
      });
    const output = command === 'verify-harvest-checkout'
      ? { ...result, authenticatedPlan: structuredClone(plan) }
      : result;
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      command,
      blocker: error.message,
      authenticated: false,
      truthBoundary: 'No qualification job was authorized or dispatched.',
    })}\n`);
    process.exitCode = 1;
  }
}
