import { preflightLeanProofKernel } from './lean-proof-preflight.mjs';
import {
  assertQualificationDeployment,
  deploymentBindingDigest,
} from './deployment-identity.mjs';
import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  phdCampaignVerificationBundleSha256,
  verifyPhdCampaign,
  verifyPhdCampaignReport,
} from './phd-campaign.mjs';

export const LAYERED_PHD_STATUS_SCHEMA = 'cortex.learning_os.layered_phd_status.v1';

function canonicalEqual(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

export function buildLayeredPhdStatus({
  program,
  acquisitionStatus = null,
  acquisitionStateVerified = false,
  retentionStatus = null,
  retentionStatusVerified = false,
  campaignReport = null,
  campaignBundle = null,
  qualificationDeployment = null,
  qualificationSigningSecret = null,
  proofPreflight = preflightLeanProofKernel(),
  evaluatedAt = new Date().toISOString(),
} = {}) {
  let campaignReportVerified = false;
  let qualificationDeploymentVerified = false;
  let selectedDeployment = program?.deployment || null;
  if (qualificationDeployment !== null) {
    try {
      selectedDeployment = assertQualificationDeployment(
        qualificationDeployment,
        program?.deployment,
      );
      qualificationDeploymentVerified = true;
    } catch {
      qualificationDeploymentVerified = false;
    }
  }
  const qualificationBundleDeploymentMatches = Boolean(
    campaignBundle?.expectedDeployment
      && campaignBundle?.campaign?.deployment
      && canonicalEqual(campaignBundle.expectedDeployment, selectedDeployment)
      && canonicalEqual(campaignBundle.campaign.deployment, selectedDeployment),
  );
  if (campaignReport && campaignBundle && typeof qualificationSigningSecret === 'string'
      && qualificationSigningSecret.length >= 32 && program?.ok === true
      && qualificationDeploymentVerified
      && qualificationBundleDeploymentMatches) {
    try {
      const verificationBundleSha256 =
        phdCampaignVerificationBundleSha256(campaignBundle);
      const recomputed = verifyPhdCampaign({
        ...campaignBundle,
        expectedDeployment: selectedDeployment,
        graph: program.graph,
        rubric: program.rubric,
        retentionPolicy: program.retentionPolicy,
        signingSecret: qualificationSigningSecret,
        evaluatedAt: campaignReport.evaluatedAt,
        verificationBundleSha256,
      });
      campaignReportVerified = verifyPhdCampaignReport(
        campaignReport,
        qualificationSigningSecret,
      ) && campaignReport.verificationBundleSha256 === verificationBundleSha256
        && canonicalJson(recomputed) === canonicalJson(campaignReport);
    } catch {
      campaignReportVerified = false;
    }
  }
  const acquisition = acquisitionStatus && acquisitionStateVerified
    ? (acquisitionStatus.acquiredOnce?.count === 264
      && acquisitionStatus.unassessed?.count === 0
      && acquisitionStatus.learningOrCorrection?.count === 0
      ? 'acquired_once_complete' : 'in_progress')
    : acquisitionStatus ? 'unverified' : 'not_initialized';
  const productionRetentionVerified = retentionStatusVerified
    && retentionStatus?.fixtureOnly === false;
  const retention = retentionStatus && productionRetentionVerified
    ? retentionStatus.status
    : retentionStatus ? 'unverified' : 'not_started';
  const qualification = campaignReport && campaignReportVerified
    ? (campaignReport.layers?.qualification ? 'passed' : 'failed_or_incomplete')
    : campaignReport ? 'unverified' : 'not_started';
  const proof = campaignReportVerified && campaignReport?.layers?.proof
    ? 'passed'
    : proofPreflight.status === 'ready' ? 'kernel_ready_no_qualification_evidence' : `kernel_${proofPreflight.status}`;
  const specialization = campaignReport && campaignReportVerified
    ? (campaignReport.layers?.specialization ? 'passed' : 'failed_or_incomplete')
    : campaignReport ? 'unverified' : 'not_started';
  const research = campaignReport && campaignReportVerified
    ? (campaignReport.layers?.research ? 'passed' : 'failed_or_incomplete')
    : campaignReport ? 'unverified' : 'not_started';
  const claimQualified = program?.ok === true
    && program?.productionTrustReady === true
    && program?.sourceMode === 'exact_git_blobs'
    && campaignReportVerified
    && campaignReport?.phd_math_qualified === true;
  const productionProgramReady = program?.productionTrustReady === true
    && program?.sourceMode === 'exact_git_blobs';
  const programStatus = !program?.ok
    ? 'blocked'
    : productionProgramReady
      ? 'production_ready'
      : 'structurally_valid_production_blocked';
  return {
    schemaVersion: LAYERED_PHD_STATUS_SCHEMA,
    evaluatedAt,
    program: {
      status: programStatus,
      errors: program?.errors || ['program was not loaded'],
      productionTrustReady: productionProgramReady,
      productionTrustBlockers: program?.productionTrustBlockers || [],
      deploymentDigest: selectedDeployment
        ? deploymentBindingDigest(selectedDeployment)
        : null,
    },
    acquisition: { status: acquisition, reviewSelectionEnabled: false },
    retention: {
      status: retention,
      retainedMasteryQualified: retention === 'retained_mastery_qualified',
    },
    qualification: { status: qualification },
    proof: { status: proof, realLeanPassed: campaignReportVerified && campaignReport?.layers?.proof === true },
    specialization: { status: specialization },
    research: { status: research },
    phd_math_qualified: claimQualified,
    truthBoundary: claimQualified
      ? campaignReport.claimTruth
      : 'Acquisition, retention, qualification, proof, specialization, and research are independent truth layers. Missing evidence never becomes an optimistic percentage.',
  };
}
