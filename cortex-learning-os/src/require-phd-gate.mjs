#!/usr/bin/env node
import {
  assertQualificationDeployment,
  deploymentBindingDigest,
} from './deployment-identity.mjs';
import {
  assertAuthorityBindings,
  readAuthorityJson,
  readAuthoritySecret,
  readRootBrokeredAuthorityJson,
  validateAuthorityExpectations,
} from './authority-input.mjs';
import { preflightLeanProofKernel } from './lean-proof-preflight.mjs';
import {
  acquisitionBindingFromReceipt,
  phdCampaignVerificationBundleSha256,
  validateProductionAcquisitionQualificationReceipt,
  verifyQualificationHarvestEvidence,
  verifyPhdCampaign,
  verifyPhdCampaignReport,
} from './phd-campaign.mjs';
import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { verifyProductionRetentionQualification } from './phd-retention.mjs';
import { validatePhdTrustPolicy } from './phd-trust.mjs';
import {
  currentCommittedIdentity,
} from './git-product-source.mjs';
import { loadCanonicalPhdProgram } from './phd-program-runtime.mjs';
import { verifyQualificationLaunchPlan } from './phd-qualification-launch.mjs';

const gate = process.argv[2];

function readRequired(environmentName, {
  brokered = false,
  consume = null,
} = {}) {
  const supplied = process.env[environmentName];
  if (!supplied) throw new Error(`${environmentName} must name an external production evidence file`);
  if (consume !== null && typeof consume !== 'function') {
    throw new Error(`${environmentName} protected consumer is invalid`);
  }
  const snapshot = brokered
    ? readRootBrokeredAuthorityJson(supplied, environmentName, { consume })
    : readAuthorityJson(supplied, environmentName, { consume });
  return consume === null ? snapshot.record : snapshot.consumed;
}

function readControlPlaneSecret(expectedKeyId) {
  const supplied = process.env.CLOS_QUALIFICATION_SECRET;
  if (!supplied) throw new Error('CLOS_QUALIFICATION_SECRET must name the owner-only control-plane secret');
  return readAuthoritySecret(supplied, {
    label: 'qualification secret',
    expectedKeyId,
  }).secret;
}

function authenticatedQualificationDeployment({
  program,
  plan,
  signingSecret,
  expectedAuthority,
  now,
} = {}) {
  verifyQualificationLaunchPlan({
    plan,
    signingSecret,
    expectedSubjectId: expectedAuthority.subjectId,
    expectedCampaignDigest: expectedAuthority.campaignDigest,
    expectedDeploymentDigest: expectedAuthority.deploymentDigest,
    now,
    authorization: 'archival_harvest',
  });
  assertAuthorityBindings({
    subjectId: plan.subjectId,
    campaignDigest: plan.campaignDigest,
    deploymentDigest: deploymentBindingDigest(plan.deployment),
    keyId: plan.controlPlaneSignature?.keyId,
  }, expectedAuthority, 'qualification plan');
  return assertQualificationDeployment(plan.deployment, program.deployment);
}

try {
  const identity = currentCommittedIdentity({ requireClean: true });
  const program = loadCanonicalPhdProgram(identity);
  if (!program.ok) throw new Error(`committed PhD program is invalid: ${program.errors.join('; ')}`);
  const expectedAuthority = validateAuthorityExpectations({
    subjectId: process.env.CLOS_EXPECTED_SUBJECT_ID,
    campaignDigest: process.env.CLOS_EXPECTED_CAMPAIGN_DIGEST,
    deploymentDigest: process.env.CLOS_EXPECTED_DEPLOYMENT_DIGEST,
    keyId: process.env.CLOS_EXPECTED_QUALIFICATION_KEY_ID,
  });
  if (gate === 'lean-real') {
    const signingSecret = readControlPlaneSecret(expectedAuthority.keyId);
    const observedAt = new Date().toISOString();
    let deployment = null;
    readRequired('CLOS_QUALIFICATION_PLAN', {
      consume(qualificationPlan) {
        deployment = authenticatedQualificationDeployment({
          program,
          plan: qualificationPlan,
          signingSecret,
          expectedAuthority,
          now: observedAt,
        });
        return qualificationPlan;
      },
    });
    const preflight = preflightLeanProofKernel({
      expectedDeployment: deployment,
    });
    if (!preflight.ready || preflight.status !== 'ready') {
      throw new Error(`real authenticated Lean gate is unavailable: ${preflight.errors.join('; ')}`);
    }
  } else if (gate === 'retention') {
    const validation = validatePhdTrustPolicy(program.trustPolicy, { requireProduction: true });
    if (!validation.ok) throw new Error(`production trust is unavailable: ${validation.errors.join('; ')}`);
    const status = readRequired('CLOS_RETENTION_STATUS');
    const signingSecret = readControlPlaneSecret(expectedAuthority.keyId);
    const windows = readRequired('CLOS_RETENTION_WINDOWS');
    const assessmentBanks = readRequired('CLOS_RETENTION_BANKS');
    const acquisitionReceipt = readRequired('CLOS_ACQUISITION_RECEIPT');
    let deployment = null;
    const qualificationPlan = readRequired('CLOS_QUALIFICATION_PLAN', {
      consume(candidate) {
        deployment = authenticatedQualificationDeployment({
          program,
          plan: candidate,
          signingSecret,
          expectedAuthority,
          now: status?.evaluatedAt,
        });
        return candidate;
      },
    });
    const harvestState = readRequired('CLOS_QUALIFICATION_HARVEST_STATE');
    const artifactManifestBytesByJob = readRequired(
      'CLOS_QUALIFICATION_ARTIFACT_MANIFESTS',
    );
    const artifactFileBytesByJob = readRequired('CLOS_QUALIFICATION_ARTIFACT_FILES');
    const expectedDeploymentDigest = deploymentBindingDigest(deployment);
    if (status?.subjectId !== expectedAuthority.subjectId
        || status?.campaignBinding?.campaignDigest !== expectedAuthority.campaignDigest) {
      throw new Error('retention evidence differs from the independently configured subject or campaign');
    }
    const harvest = verifyQualificationHarvestEvidence({
      plan: qualificationPlan,
      harvestState,
      artifactManifestBytesByJob,
      artifactFileBytesByJob,
      signingSecret,
      now: status?.evaluatedAt,
      requireArtifactManifests: true,
      requireArtifactFiles: true,
    });
    if (!harvest.ok
        || canonicalJson(status?.campaignBinding) !== canonicalJson({
          campaignId: qualificationPlan?.campaignId,
          campaignDigest: qualificationPlan?.campaignDigest,
        })) {
      throw new Error(`production retention harvest is invalid: ${harvest.errors.join('; ')}`);
    }
    const acquisitionValidation = validateProductionAcquisitionQualificationReceipt({
      receipt: acquisitionReceipt,
      graph: program.graph,
      rubric: program.rubric,
      trustPolicy: program.trustPolicy,
      deployment,
      signingSecret,
    });
    if (!acquisitionValidation.ok) {
      throw new Error(`production retention acquisition receipt is invalid: ${acquisitionValidation.errors.join('; ')}`);
    }
    const acquisitionBinding = acquisitionBindingFromReceipt(acquisitionReceipt, signingSecret, {
      graph: program.graph,
      rubric: program.rubric,
      trustPolicy: program.trustPolicy,
      deployment,
    });
    const retentionValidation = verifyProductionRetentionQualification({
      status,
      windows,
      assessmentBanks,
      policy: program.retentionPolicy,
      deployment,
      trustPolicy: program.trustPolicy,
      campaignBinding: status?.campaignBinding,
      acquisitionBinding,
      graph: program.graph,
      rubric: program.rubric,
      signingSecret,
      qualificationHarvestBinding: harvest.binding,
      harvestedModelCallsByJob: harvest.modelCallsByJob,
    });
    if (!retentionValidation.ok
        || status.deploymentDigest !== expectedDeploymentDigest) {
      throw new Error(`production retention evidence is absent or not qualified: ${retentionValidation.errors.join('; ')}`);
    }
  } else if (gate === 'phd') {
    const validation = validatePhdTrustPolicy(program.trustPolicy, { requireProduction: true });
    if (!validation.ok) throw new Error(`production trust is unavailable: ${validation.errors.join('; ')}`);
    const signingSecret = readControlPlaneSecret(expectedAuthority.keyId);
    const campaignAccepted = readRequired('CLOS_PHD_CAMPAIGN_REPORT', {
      brokered: true,
      consume(report) {
        return readRequired('CLOS_PHD_CAMPAIGN_BUNDLE', {
          brokered: true,
          consume(campaignBundle) {
            const deployment = authenticatedQualificationDeployment({
              program,
              plan: campaignBundle.qualificationPlan,
              signingSecret,
              expectedAuthority,
              now: report.evaluatedAt,
            });
            const expectedDeploymentDigest = deploymentBindingDigest(deployment);
            assertAuthorityBindings({
              subjectId: report.subjectId,
              campaignDigest: campaignBundle.qualificationPlan?.campaignDigest,
              deploymentDigest: report.deploymentDigest,
              keyId: report.controlPlaneSignature?.keyId,
            }, expectedAuthority, 'PhD campaign report and bundle');
            const verificationBundleSha256 =
              phdCampaignVerificationBundleSha256(campaignBundle);
            const recomputed = verifyPhdCampaign({
              ...campaignBundle,
              expectedDeployment: deployment,
              graph: program.graph,
              rubric: program.rubric,
              retentionPolicy: program.retentionPolicy,
              signingSecret,
              evaluatedAt: report.evaluatedAt,
              verificationBundleSha256,
            });
            if (!verifyPhdCampaignReport(report, signingSecret)
                || canonicalJson(report) !== canonicalJson(recomputed)
                || report.verificationBundleSha256 !== verificationBundleSha256
                || report.phd_math_qualified !== true
                || report.mechanicalGatesSatisfied !== true
                || report.deploymentDigest !== expectedDeploymentDigest
                || !report.layers
                || Object.values(report.layers).some((passed) => passed !== true)) {
              throw new Error('production PhD campaign bundle is absent, does not reproduce the exact report, or is not qualified');
            }
            return true;
          },
        });
      },
    });
    if (campaignAccepted !== true) {
      throw new Error(
        'production PhD campaign report and underlying bundle were not consumed under nested pinned immutable-object handoffs',
      );
    }
  } else {
    throw new Error('unknown required gate');
  }
  console.log(JSON.stringify({
    ok: true,
    gate,
    truthBoundary: 'This command checks an external production gate; it does not create evidence.',
  }));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    gate,
    blocker: error.message,
    truthBoundary: 'Missing, skipped, fixture, or unauthenticated evidence is non-green.',
  }));
  process.exitCode = 1;
}
