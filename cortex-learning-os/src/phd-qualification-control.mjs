#!/usr/bin/env node
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  atomicWriteSignedControlPlaneRecord,
} from './authenticated-control-publication.mjs';
import {
  assertAuthorityBindings,
  authorityKeyId,
  readAuthorityJson,
  readAuthoritySecret,
  validateAuthorityExpectations,
} from './authority-input.mjs';
import {
  assembleExamAttempt,
  assembleProofRun,
  assembleProductionResearchEvidence,
  buildCanonicalQualificationJobs,
  createAcquisitionQualificationReceipt,
  createProofReplayReceipt,
  freezePhdCampaign,
  verifyQualificationHarvestEvidence,
  verifyAndAtomicWritePhdCampaignReport,
} from './phd-campaign.mjs';
import {
  assertRetentionResumeProcessIdentity,
  buildRetentionWaitContract,
  buildRetentionWindowTask,
  evaluateRetentionStatus,
  gradeRetentionWindow,
  installRetentionResumeTimer,
  processRetentionResumeTimerFiring,
  persistRetentionWaitContract,
  readRetentionProtectedJson,
  readRetentionProtectedSecret,
  reconcileRetentionResumeTimer,
  releaseRetentionWindow,
  verifyRetentionTimerJournal,
  verifyRetentionWaitContract,
} from './phd-retention.mjs';
import { validateProductionControlBundle } from './phd-control-boundary.mjs';
import {
  deploymentBindingDigest,
  sourceDeploymentBinding,
} from './deployment-identity.mjs';
import { currentCommittedIdentity } from './git-product-source.mjs';
import { sha256Bytes, sha256Text } from './hash.mjs';
import {
  loadCanonicalPhdProgram,
  loadCanonicalPhdProgramFromCheckout,
} from './phd-program-runtime.mjs';

const args = process.argv.slice(2);
const command = args[0];
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
};

function readJson(target, consume = null) {
  const snapshot = readAuthorityJson(target, 'control-plane input', {
    consume,
  });
  return consume === null ? snapshot.record : snapshot.consumed;
}

function ownerSecret(flag = '--secret', expectedKeyId = value('--expected-key-id')) {
  const target = value(flag);
  if (!target) throw new Error(`${flag} is required`);
  return readAuthoritySecret(target, {
    label: flag,
    expectedKeyId,
  }).secret;
}

function writeNew(target, record, signingSecret) {
  if (typeof target !== 'string' || target.length < 1) throw new Error('--out is required');
  return atomicWriteSignedControlPlaneRecord(target, record, signingSecret);
}

function assertCompletedRetentionResume(result, signingSecret) {
  const releaseBytes = Buffer.from(
    `${JSON.stringify(result?.release, null, 2)}\n`,
    'utf8',
  );
  const releasedTransition = result?.journal?.transitions?.at(-1);
  if (result?.released !== true
      || result?.dryRun !== false
      || result?.contract?.timerInstalled !== true
      || result.contract.fixtureOnly !== false
      || result.contract.timerReleased !== true
      || result?.journal?.phase !== 'released'
      || releasedTransition?.phase !== 'released'
      || !result.release
      || result.release.fixtureOnly !== false
      || result.release.releasedAt !== result.contract.timerFiredAt
      || releasedTransition.evidence?.releasePath !== result.contract.releasePath
      || releasedTransition.evidence?.releaseDigest
        !== sha256Text(canonicalJson(result.release))
      || releasedTransition.evidence?.releaseFileSha256
        !== sha256Bytes(releaseBytes)
      || result.contract.releaseDigest !== releasedTransition.evidence.releaseDigest
      || result.contract.releaseFileSha256
        !== releasedTransition.evidence.releaseFileSha256
      || !verifyRetentionWaitContract(result.contract, signingSecret)
      || !verifyRetentionTimerJournal({
        journal: result.journal,
        contract: result.contract,
        signingSecret,
      })) {
    throw new Error(
      'retention due-time entrypoint did not durably commit and consume the exact released wait, journal, and release successor',
    );
  }
}

try {
  const bundlePath = value('--bundle');
  if (!bundlePath) throw new Error('--bundle is required');
  const waitPathForResume = command === 'retention-resume'
    ? value('--wait-state')
    : null;
  const waitBootstrap = waitPathForResume === null
    ? null
    : readJson(waitPathForResume);
  const expectedAuthority = validateAuthorityExpectations({
    subjectId: value('--expected-subject-id'),
    campaignDigest: value('--expected-campaign-digest'),
    deploymentDigest: value('--expected-deployment-digest'),
    keyId: value('--expected-key-id'),
  });
  if (waitBootstrap !== null) {
    assertRetentionResumeProcessIdentity(waitBootstrap.stateRootIdentity, {
      requireProduction: true,
    });
  }
  const signingSecret = waitBootstrap === null
    ? ownerSecret('--secret', expectedAuthority.keyId)
    : readRetentionProtectedSecret(
      value('--secret'),
      waitBootstrap.stateRootIdentity,
      { expectedKeyId: expectedAuthority.keyId },
    );
  if (authorityKeyId(signingSecret) !== expectedAuthority.keyId) {
    throw new Error('qualification secret differs from the independently configured key ID');
  }
  if (waitBootstrap !== null
      && (!verifyRetentionWaitContract(waitBootstrap, signingSecret)
        || waitBootstrap.statePath !== path.resolve(waitPathForResume)
        || waitBootstrap.resumeBundlePath !== path.resolve(bundlePath))) {
    throw new Error('retention resume wait signature, state path, or bundle path mismatch');
  }
  if (waitBootstrap !== null) {
    if (value('--expected-campaign-id')
          !== waitBootstrap.campaignBinding.campaignId
        || value('--expected-window-index')
          !== String(waitBootstrap.nextWindowIndex)
        || value('--expected-previous-window-digest')
          !== (waitBootstrap.previousWindowDigest ?? 'none')
        || value('--expected-task-digest') !== waitBootstrap.dueTaskDigest) {
      throw new Error(
        'retention resume CLI campaign, window, predecessor, or task pin differs from the signed wait',
      );
    }
    assertAuthorityBindings({
      subjectId: waitBootstrap.subjectId,
      campaignDigest: waitBootstrap.campaignBinding.campaignDigest,
      deploymentDigest: waitBootstrap.deploymentDigest,
      keyId: waitBootstrap.controlPlaneSignature.keyId,
    }, expectedAuthority, 'signed retention resume wait');
  }
  const canonicalProgram = waitBootstrap === null
    ? loadCanonicalPhdProgram(currentCommittedIdentity({ requireClean: true }))
    : loadCanonicalPhdProgramFromCheckout({
      sourceCommit: waitBootstrap.resumeExecution.executionClosure.sourceCommit,
      sourceTree: waitBootstrap.resumeExecution.executionClosure.sourceTree,
      productTree: waitBootstrap.resumeExecution.executionClosure.productTree,
      executionClosure: waitBootstrap.resumeExecution.executionClosure,
      checkoutRoot: waitBootstrap.resumeExecution.checkoutRoot,
    });
  const consumeControlBundle = (candidate) => {
    const boundary = validateProductionControlBundle({
      bundle: candidate,
      canonicalProgram,
      command,
      retentionWait: waitBootstrap,
    });
    if (!boundary.ok) {
      throw new Error(
        `production control boundary rejected bundle: ${
          boundary.errors.join('; ')
        }`,
      );
    }
    if (canonicalJson(sourceDeploymentBinding(candidate.expectedDeployment))
        !== canonicalJson(canonicalProgram.deployment)) {
      throw new Error('control bundle exact deployment check failed');
    }
    const authorityPlan = candidate.qualificationPlan || null;
    const authorityCampaign = candidate.campaign || null;
    const authoritySubjectId = waitBootstrap?.subjectId
      || authorityPlan?.subjectId
      || authorityCampaign?.subjectId
      || candidate.task?.subjectId
      || candidate.status?.subjectId
      || candidate.subjectId;
    const authorityCampaignDigest = waitBootstrap?.campaignBinding?.campaignDigest
      || authorityPlan?.campaignDigest
      || candidate.campaignBinding?.campaignDigest
      || candidate.status?.campaignBinding?.campaignDigest
      || (authorityCampaign === null
        ? null
        : sha256Text(canonicalJson(authorityCampaign)));
    if (authoritySubjectId !== null && authoritySubjectId !== undefined
        && authorityCampaignDigest !== null
        && authorityCampaignDigest !== undefined) {
      assertAuthorityBindings({
        subjectId: authoritySubjectId,
        campaignDigest: authorityCampaignDigest,
        deploymentDigest: deploymentBindingDigest(
          candidate.expectedDeployment,
        ),
        keyId: waitBootstrap?.controlPlaneSignature?.keyId
          || authorityPlan?.controlPlaneSignature?.keyId
          || authorityCampaign?.controlPlaneSignature?.keyId
          || expectedAuthority.keyId,
      }, expectedAuthority, 'production control bundle');
    } else if (command !== 'campaign-freeze') {
      throw new Error(
        'control bundle omits the independently pinned subject or campaign identity',
      );
    }
    return candidate;
  };
  const bundle = waitBootstrap === null
    ? readJson(bundlePath, consumeControlBundle)
    : readRetentionProtectedJson(
      bundlePath,
      waitBootstrap.stateRootIdentity,
      { consume: consumeControlBundle },
    );
  let qualificationHarvestBinding = null;
  let harvestedModelCallsByJob = null;
  let harvestedWorkerCall = null;
  const controlPlaneObservedAt = new Date().toISOString();
  if ([
    'exam-assemble',
    'proof-assemble',
    'proof-replay',
    'research-assemble',
    'retention-grade',
    'retention-status',
    'campaign-verify',
  ].includes(command)) {
    const harvest = verifyQualificationHarvestEvidence({
      plan: bundle.qualificationPlan,
      harvestState: bundle.harvestState,
      artifactManifestBytesByJob: bundle.artifactManifestBytesByJob,
      artifactFileBytesByJob: bundle.artifactFileBytesByJob,
      campaign: bundle.campaign,
      signingSecret,
      now: controlPlaneObservedAt,
      requireArtifactManifests: true,
      requireArtifactFiles: true,
    });
    if (!harvest.ok) {
      throw new Error(`production qualification harvest rejected bundle: ${harvest.errors.join('; ')}`);
    }
    qualificationHarvestBinding = harvest.binding;
    harvestedModelCallsByJob = harvest.modelCallsByJob;
    const expectedJobId = command === 'exam-assemble'
      ? `${bundle.campaign.campaignId}.${bundle.examId}`
      : ['proof-assemble', 'proof-replay'].includes(command)
        ? `${bundle.campaign.campaignId}.${bundle.obligationId}`
        : command === 'research-assemble'
          ? `${bundle.campaign.campaignId}.research_candidate`
          : command === 'retention-grade'
            ? `${bundle.qualificationPlan.campaignId}.retention.${bundle.task?.windowIndex}`
          : null;
    if (expectedJobId !== null) {
      const receipt = harvest.receiptsByJob.get(expectedJobId);
      const manifest = harvest.manifestsByJob.get(expectedJobId);
      const call = command === 'exam-assemble'
        ? bundle.modelCall
        : command === 'research-assemble'
          ? bundle.candidateCall
          : command === 'retention-grade'
            ? bundle.attempt
            : bundle.candidateCall;
      const files = harvest.filesByJob.get(expectedJobId);
      harvestedWorkerCall = harvest.modelCallsByJob.get(expectedJobId) || null;
      const rawOutput = command === 'retention-grade'
        ? Buffer.from(call?.rawOutputBase64 || '', 'base64')
        : command === 'exam-assemble'
          ? Buffer.from(bundle.outputBase64 || '', 'base64')
          : Buffer.from(bundle.candidateOutputBase64 || '', 'base64');
      if (!receipt
          || (command !== 'proof-replay'
            && (call?.jobId !== expectedJobId
              || call?.jobDigest !== receipt.jobDigest
              || call?.notBefore !== receipt.notBefore
              || call?.executionIntervalSha256 !== receipt.executionIntervalSha256
              || call?.startedAt !== receipt.startedAt
              || call?.completedAt !== receipt.completedAt
              || call?.expiresAt !== receipt.expiresAt
              || canonicalJson(call?.executionEvidenceCore)
                !== canonicalJson(harvestedWorkerCall?.executionEvidenceCore)
              || call?.executionEvidenceSha256
                !== harvestedWorkerCall?.executionEvidenceSha256
              || canonicalJson(call?.executionIdentity)
                !== canonicalJson(receipt.executionIdentity)
              || call?.promptSha256 !== manifest?.promptSha256
              || call?.outputSha256 !== manifest?.outputSha256
              || !files
              || !(files.get('output.json') || Buffer.alloc(0)).equals(rawOutput)
              || (command === 'retention-grade'
                && (!(files.get('raw-events.ndjson') || Buffer.alloc(0)).equals(
                  Buffer.from(call?.rawEventLedgerBase64 || '', 'base64'),
                )
                  || !(files.get('stderr.raw') || Buffer.alloc(0)).equals(
                    Buffer.from(call?.rawStderrBase64 || '', 'base64'),
                  )))))) {
        throw new Error('assembler worker evidence is not a member of the exact signed harvest set');
      }
    }
  }
  let result;
  if (command === 'acquisition-receipt') {
    result = createAcquisitionQualificationReceipt({
      ...bundle,
      masterySecret: ownerSecret(
        '--mastery-secret',
        value('--expected-mastery-key-id'),
      ),
      signingSecret,
    });
    writeNew(value('--out'), result, signingSecret);
  } else if (command === 'retention-task') {
    result = buildRetentionWindowTask({ ...bundle, signingSecret });
    writeNew(value('--out'), result, signingSecret);
  } else if (command === 'retention-release') {
    result = releaseRetentionWindow({ ...bundle, signingSecret });
    writeNew(value('--out'), result, signingSecret);
  } else if (command === 'retention-grade') {
    result = gradeRetentionWindow({
      ...bundle,
      qualificationHarvestBinding,
      harvestedWorkerCall,
      signingSecret,
    });
    writeNew(value('--out'), result, signingSecret);
  } else if (command === 'retention-status') {
    result = evaluateRetentionStatus({
      ...bundle,
      qualificationHarvestBinding,
      harvestedModelCallsByJob,
      signingSecret,
    });
    writeNew(value('--out'), result, signingSecret);
  } else if (command === 'retention-wait-build') {
    result = buildRetentionWaitContract({ ...bundle, signingSecret });
    writeNew(value('--out'), result, signingSecret);
  } else if (command === 'retention-wait-persist') {
    result = persistRetentionWaitContract({ ...bundle, signingSecret });
  } else if (command === 'retention-wait-install') {
    result = installRetentionResumeTimer({
      contract: bundle.contract,
      waitPath: bundle.waitPath,
      signingSecret,
    });
  } else if (command === 'retention-wait-reconcile') {
    result = reconcileRetentionResumeTimer({
      contract: bundle.contract,
      waitPath: bundle.waitPath,
      signingSecret,
    });
  } else if (command === 'campaign-freeze') {
    result = freezePhdCampaign({ ...bundle, signingSecret });
    assertAuthorityBindings({
      subjectId: result.subjectId,
      campaignDigest: sha256Text(canonicalJson(result)),
      deploymentDigest: deploymentBindingDigest(result.deployment),
      keyId: result.controlPlaneSignature?.keyId,
    }, expectedAuthority, 'frozen production campaign');
    writeNew(value('--out'), result, signingSecret);
  } else if (command === 'jobs-build') {
    if (Object.hasOwn(bundle, 'additionalDescriptors')) {
      throw new Error('caller-supplied extra job descriptors are forbidden');
    }
    result = buildCanonicalQualificationJobs({
      ...bundle,
      signingSecret,
    });
    writeNew(value('--out'), result, signingSecret);
  } else if (command === 'exam-assemble') {
    result = assembleExamAttempt({
      ...bundle,
      outputBytes: Buffer.from(bundle.outputBase64 || '', 'base64'),
      rawEventLedgerBytes: Buffer.from(bundle.rawEventLedgerBase64 || '', 'base64'),
      rawStderrBytes: Buffer.from(bundle.rawStderrBase64 || '', 'base64'),
      harvestObservedAt: controlPlaneObservedAt,
      signingSecret,
    });
    writeNew(value('--out'), result, signingSecret);
  } else if (command === 'proof-assemble') {
    result = assembleProofRun({
      ...bundle,
      taskBytes: Buffer.from(bundle.taskBytesBase64 || '', 'base64'),
      candidateBytes: Buffer.from(bundle.candidateBytesBase64 || '', 'base64'),
      trustedTemplateBytes: Buffer.from(bundle.trustedTemplateBytesBase64 || '', 'base64'),
      candidateOutputBytes: Buffer.from(bundle.candidateOutputBase64 || '', 'base64'),
      candidateRawEventLedgerBytes: Buffer.from(
        bundle.candidateRawEventLedgerBase64 || '',
        'base64',
      ),
      candidateRawStderrBytes: Buffer.from(
        bundle.candidateRawStderrBase64 || '',
        'base64',
      ),
      harvestObservedAt: controlPlaneObservedAt,
      signingSecret,
    });
    writeNew(value('--out'), result, signingSecret);
  } else if (command === 'research-assemble') {
    result = assembleProductionResearchEvidence({
      ...bundle,
      candidateOutputBytes: Buffer.from(bundle.candidateOutputBase64 || '', 'base64'),
      candidateRawEventLedgerBytes: Buffer.from(
        bundle.candidateRawEventLedgerBase64 || '',
        'base64',
      ),
      candidateRawStderrBytes: Buffer.from(
        bundle.candidateRawStderrBase64 || '',
        'base64',
      ),
      harvestObservedAt: controlPlaneObservedAt,
      signingSecret,
    });
    writeNew(value('--out'), result, signingSecret);
  } else if (command === 'proof-replay') {
    result = await createProofReplayReceipt({
      ...bundle,
      taskBytes: Buffer.from(bundle.taskBytesBase64 || '', 'base64'),
      candidateBytes: Buffer.from(bundle.candidateBytesBase64 || '', 'base64'),
      trustedTemplateBytes: Buffer.from(bundle.trustedTemplateBytesBase64 || '', 'base64'),
      replayRequestBytes: Buffer.from(bundle.replayRequestBase64 || '', 'base64'),
      harvestObservedAt: controlPlaneObservedAt,
      signingSecret,
    });
    writeNew(value('--out'), result, signingSecret);
  } else if (command === 'campaign-verify') {
    result = verifyAndAtomicWritePhdCampaignReport(
      value('--out'),
      bundle,
      signingSecret,
      { bundlePath: value('--bundle-out') },
    );
  } else if (command === 'retention-resume') {
    const waitPath = waitPathForResume;
    const wait = readRetentionProtectedJson(
      waitPath,
      waitBootstrap.stateRootIdentity,
    );
    if (bundle.releaseOut !== wait.releasePath) {
      throw new Error('retention release output differs from the signed wait successor');
    }
    result = processRetentionResumeTimerFiring({
      contract: wait,
      waitPath,
      signingSecret,
      firingSpecDigest: process.env.CLOS_RETENTION_TIMER_SPEC_SHA256 || null,
      releaseInputs: bundle,
    });
    assertCompletedRetentionResume(result, signingSecret);
  } else {
    throw new Error('unknown PhD qualification control command');
  }
  console.log(JSON.stringify({
    ok: true,
    command,
    output: value('--out') || bundle.releaseOut || null,
    truthBoundary: 'Control-plane orchestration verifies or releases bounded evidence; it does not itself establish a pass or capability.',
  }));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    command,
    blocker: error.message,
    truthBoundary: 'No partial qualification apply or optimistic claim is allowed.',
  }));
  process.exitCode = 1;
}
