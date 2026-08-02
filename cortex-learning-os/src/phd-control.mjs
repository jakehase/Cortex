#!/usr/bin/env node
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { buildAcquisitionStatus } from './acquisition-status.mjs';
import {
  assertAuthorityBindings,
  readAuthoritySecret,
  readOptionalAuthorityJson,
  readRootBrokeredAuthorityJson,
  validateAuthorityExpectations,
} from './authority-input.mjs';
import {
  assertQualificationDeployment,
  deploymentBindingDigest,
} from './deployment-identity.mjs';
import { loadCanonicalPhdProgram } from './phd-program-runtime.mjs';
import { buildLayeredPhdStatus } from './phd-status.mjs';
import { verifyMasteryState } from './mastery-state.mjs';
import {
  acquisitionBindingFromReceipt,
  phdCampaignVerificationBundleSha256,
  validateProductionAcquisitionQualificationReceipt,
  verifyQualificationHarvestEvidence,
  verifyPhdCampaign,
  verifyPhdCampaignReport,
} from './phd-campaign.mjs';
import { verifyProductionRetentionStatusEvidence } from './phd-retention.mjs';
import { CLOS_ROOT } from './paths.mjs';
import { currentCommittedIdentity } from './git-product-source.mjs';
import { verifyQualificationLaunchPlan } from './phd-qualification-launch.mjs';

const args = process.argv.slice(2);
const command = args[0] || 'status';
const value = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
function gitIdentity() {
  return currentCommittedIdentity({ requireClean: true });
}

const explicitCommit = value('--source-commit', process.env.CLOS_SOURCE_COMMIT);
const explicitTree = value('--source-tree', process.env.CLOS_SOURCE_TREE);
const explicitProductTree = value('--product-tree', process.env.CLOS_PRODUCT_TREE);

function readOptional(target) {
  return readOptionalAuthorityJson(target, 'status authority input')?.record || null;
}

function readOptionalBrokered(target, consume) {
  if (!target) return null;
  if (typeof consume !== 'function') {
    throw new Error('brokered status authority input requires a protected consumer');
  }
  try {
    return readRootBrokeredAuthorityJson(
      target,
      'brokered status authority input',
      { consume },
    ).consumed;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.cause?.code === 'ENOENT') return null;
    throw error;
  }
}

try {
  if (new Set([
    Boolean(explicitCommit),
    Boolean(explicitTree),
    Boolean(explicitProductTree),
  ]).size !== 1) {
    throw new Error('--source-commit, --source-tree, and --product-tree must be supplied together');
  }
  let resolved;
  let checkoutIdentityVerified = true;
  try {
    const actual = gitIdentity();
    if ((explicitCommit && explicitCommit !== actual.sourceCommit)
        || (explicitTree && explicitTree !== actual.sourceTree)
        || (explicitProductTree && explicitProductTree !== actual.productTree)) {
      throw new Error('explicit deployment identity differs from the checked-out commit/repository/product tree');
    }
    resolved = actual;
  } catch (error) {
    if (!explicitCommit || !explicitTree || !explicitProductTree
        || !/EPERM/.test(String(error.message))) throw error;
    resolved = {
      sourceCommit: explicitCommit,
      sourceTree: explicitTree,
      productTree: explicitProductTree,
    };
    checkoutIdentityVerified = false;
  }
  const { sourceCommit, sourceTree, productTree } = resolved;
  const program = loadCanonicalPhdProgram({ sourceCommit, sourceTree, productTree });
  if (command === 'validate') {
    console.log(JSON.stringify({
      ok: program.ok,
      schemaVersion: program.schemaVersion,
      errors: program.errors,
      deployment: program.deployment,
      assessmentCoverage: program.assessmentCoverage,
      proofObligationCount: program.proofRegistry.entries.length,
      sourceMode: program.sourceMode,
      productionTrustReady: program.productionTrustReady,
      productionTrustBlockers: program.productionTrustBlockers,
      checkoutIdentityVerified,
      identityBlocker: checkoutIdentityVerified
        ? null
        : 'managed control-plane sandbox denied Git subprocess verification; deploy/qualification launchers must independently match commit and tree',
      truthBoundary: program.truthBoundary,
    }, null, 2));
    process.exitCode = program.ok ? 0 : 1;
  } else if (command === 'status') {
    const stateRoot = path.resolve(value('--state-root', path.join(
      process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || '/root', '.openclaw'),
      'cortex-learning-os',
    )));
    const mastery = readOptional(value('--mastery', path.join(stateRoot, 'mastery.json')));
    const retentionStatus = readOptional(value('--retention', path.join(stateRoot, 'phd/retention-status.json')));
    const retentionWindows = retentionStatus
      ? readOptional(value('--retention-windows', path.join(stateRoot, 'phd/retention-windows.json')))
      : null;
    const retentionBanks = retentionStatus
      ? readOptional(value('--retention-banks', path.join(stateRoot, 'phd/retention-banks.json')))
      : null;
    const acquisitionReceipt = retentionStatus
      ? readOptional(value('--acquisition-receipt', path.join(stateRoot, 'phd/acquisition-receipt.json')))
      : null;
    const qualificationPlan = retentionStatus
      ? readOptional(value('--qualification-plan', path.join(stateRoot, 'phd/qualification-plan.json')))
      : null;
    const harvestState = retentionStatus
      ? readOptional(value('--harvest-state', path.join(stateRoot, 'phd/qualification-harvest-state.json')))
      : null;
    const artifactManifestBytesByJob = retentionStatus
      ? readOptional(value('--artifact-manifests', path.join(stateRoot, 'phd/qualification-artifact-manifests.json')))
      : null;
    const artifactFileBytesByJob = retentionStatus
      ? readOptional(value('--artifact-files', path.join(stateRoot, 'phd/qualification-artifact-files.json')))
      : null;
    const campaignReportPath = value(
      '--campaign',
      path.join(stateRoot, 'phd/campaign-report.json'),
    );
    const campaignBundlePath = value(
      '--campaign-bundle',
      path.join(stateRoot, 'phd/campaign-bundle.json'),
    );
    if (!checkoutIdentityVerified && (mastery || retentionStatus)) {
      throw new Error('status evidence cannot be evaluated without checked-out Git identity verification');
    }
    const qualificationSecretPath = value('--qualification-secret', path.join(stateRoot, 'phd/qualification.hmac'));
    let expectedAuthority = (retentionStatus || qualificationPlan)
      ? validateAuthorityExpectations({
        subjectId: value('--expected-subject-id'),
        campaignDigest: value('--expected-campaign-digest'),
        deploymentDigest: value('--expected-deployment-digest'),
        keyId: value('--expected-key-id'),
      })
      : null;
    let qualificationSecret = null;
    const statusAuthority = () => {
      if (expectedAuthority === null) {
        expectedAuthority = validateAuthorityExpectations({
          subjectId: value('--expected-subject-id'),
          campaignDigest: value('--expected-campaign-digest'),
          deploymentDigest: value('--expected-deployment-digest'),
          keyId: value('--expected-key-id'),
        });
      }
      return expectedAuthority;
    };
    const statusQualificationSecret = () => {
      const authority = statusAuthority();
      if (qualificationSecret !== null) return qualificationSecret;
      qualificationSecret = readAuthoritySecret(qualificationSecretPath, {
        label: 'qualification secret',
        expectedKeyId: authority.keyId,
      }).secret;
      return qualificationSecret;
    };
    let qualificationDeployment = null;
    const authenticateStatusPlan = (plan, evaluatedAt) => {
      if (!plan) return null;
      const authority = statusAuthority();
      const signingSecret = statusQualificationSecret();
      assertAuthorityBindings({
        subjectId: plan.subjectId,
        campaignDigest: plan.campaignDigest,
        deploymentDigest: deploymentBindingDigest(plan.deployment),
        keyId: plan.controlPlaneSignature?.keyId,
      }, authority, 'status qualification plan');
      verifyQualificationLaunchPlan({
        plan,
        signingSecret,
        expectedSubjectId: authority.subjectId,
        expectedCampaignDigest: authority.campaignDigest,
        expectedDeploymentDigest: authority.deploymentDigest,
        now: evaluatedAt,
        authorization: 'archival_harvest',
      });
      const authenticatedDeployment = assertQualificationDeployment(
        plan.deployment,
        program.deployment,
      );
      if (qualificationDeployment !== null
          && canonicalJson(qualificationDeployment)
            !== canonicalJson(authenticatedDeployment)) {
        throw new Error('retention and campaign evidence use different deployments');
      }
      qualificationDeployment = authenticatedDeployment;
      return authenticatedDeployment;
    };
    if (retentionStatus) statusQualificationSecret();
    if (qualificationPlan) {
      authenticateStatusPlan(qualificationPlan, retentionStatus?.evaluatedAt);
    }
    const campaignPair = readOptionalBrokered(
      campaignReportPath,
      (report) => {
        if (!checkoutIdentityVerified) {
          throw new Error(
            'status evidence cannot be evaluated without checked-out Git identity verification',
          );
        }
        const pair = readOptionalBrokered(
          campaignBundlePath,
          (bundle) => {
            if (qualificationPlan
                && canonicalJson(qualificationPlan)
                  !== canonicalJson(bundle.qualificationPlan)) {
              throw new Error(
                'retention and campaign evidence use different qualification plans',
              );
            }
            const authenticatedDeployment = authenticateStatusPlan(
              qualificationPlan || bundle.qualificationPlan,
              report.evaluatedAt,
            );
            const signingSecret = statusQualificationSecret();
            const verificationBundleSha256 =
              phdCampaignVerificationBundleSha256(bundle);
            const recomputed = verifyPhdCampaign({
              ...bundle,
              expectedDeployment: authenticatedDeployment,
              graph: program.graph,
              rubric: program.rubric,
              retentionPolicy: program.retentionPolicy,
              signingSecret,
              evaluatedAt: report.evaluatedAt,
              verificationBundleSha256,
            });
            if (!verifyPhdCampaignReport(report, signingSecret)
                || canonicalJson(recomputed) !== canonicalJson(report)
                || report.verificationBundleSha256
                  !== verificationBundleSha256) {
              throw new Error(
                'campaign bundle does not reproduce the exact signed campaign report',
              );
            }
            assertAuthorityBindings({
              subjectId: report.subjectId,
              campaignDigest: bundle.qualificationPlan?.campaignDigest,
              deploymentDigest: report.deploymentDigest,
              keyId: report.controlPlaneSignature?.keyId,
            }, statusAuthority(), 'status campaign report');
            return {
              campaignBundle: bundle,
              campaignReport: report,
            };
          },
        );
        if (pair === null) {
          throw new Error(
            'campaign report cannot authorize status without its complete immutable campaign bundle',
          );
        }
        return pair;
      },
    );
    const campaignReport = campaignPair?.campaignReport || null;
    const campaignBundle = campaignPair?.campaignBundle || null;
    let retentionStatusVerified = false;
    if (retentionStatus) {
      if (retentionStatus.subjectId !== expectedAuthority.subjectId
          || retentionStatus.campaignBinding?.campaignDigest
            !== expectedAuthority.campaignDigest) {
        throw new Error('retention status differs from the independently configured subject or campaign');
      }
      const harvest = verifyQualificationHarvestEvidence({
        plan: qualificationPlan,
        harvestState,
        artifactManifestBytesByJob,
        artifactFileBytesByJob,
        signingSecret: qualificationSecret,
        now: retentionStatus.evaluatedAt,
        requireArtifactManifests: true,
        requireArtifactFiles: true,
      });
      if (!harvest.ok
          || canonicalJson(retentionStatus.campaignBinding) !== canonicalJson({
            campaignId: qualificationPlan?.campaignId,
            campaignDigest: qualificationPlan?.campaignDigest,
          })) {
        throw new Error(`retention qualification harvest verification failed: ${harvest.errors.join('; ')}`);
      }
      const acquisitionValidation = validateProductionAcquisitionQualificationReceipt({
        receipt: acquisitionReceipt,
        graph: program.graph,
        rubric: program.rubric,
        trustPolicy: program.trustPolicy,
        deployment: qualificationDeployment,
        signingSecret: qualificationSecret,
      });
      if (!acquisitionValidation.ok) {
        throw new Error(`retention acquisition receipt verification failed: ${acquisitionValidation.errors.join('; ')}`);
      }
      const acquisitionBinding = acquisitionBindingFromReceipt(
        acquisitionReceipt,
        qualificationSecret,
        {
          graph: program.graph,
          rubric: program.rubric,
          trustPolicy: program.trustPolicy,
          deployment: qualificationDeployment,
        },
      );
      const retentionValidation = verifyProductionRetentionStatusEvidence({
        status: retentionStatus,
        windows: retentionWindows,
        assessmentBanks: retentionBanks,
        policy: program.retentionPolicy,
        deployment: qualificationDeployment,
        trustPolicy: program.trustPolicy,
        campaignBinding: retentionStatus.campaignBinding,
        acquisitionBinding,
        graph: program.graph,
        rubric: program.rubric,
        signingSecret: qualificationSecret,
        qualificationHarvestBinding: harvest.binding,
        harvestedModelCallsByJob: harvest.modelCallsByJob,
      });
      if (!retentionValidation.ok) {
        throw new Error(`retention evidence verification failed: ${retentionValidation.errors.join('; ')}`);
      }
      retentionStatusVerified = true;
    }
    const currentDeploymentDigest = deploymentBindingDigest(
      qualificationDeployment || program.deployment,
    );
    if (retentionStatus && retentionStatus.deploymentDigest !== currentDeploymentDigest) {
      throw new Error('retention status belongs to a different deployment');
    }
    if (campaignReport && campaignReport.deploymentDigest !== currentDeploymentDigest) {
      throw new Error('campaign report belongs to a different deployment');
    }
    let acquisitionStatus = null;
    if (mastery) {
      const selected = mastery.curriculumId === program.graph.curriculumId
        ? { graph: program.graph, policy: program.acquisitionPolicy }
        : mastery.curriculumId === program.legacyGraph.curriculumId
          ? { graph: program.legacyGraph, policy: program.legacyAcquisitionPolicy }
          : null;
      if (!selected) throw new Error('signed acquisition state has an unknown curriculum');
      const masterySecret = readAuthoritySecret(
        value('--mastery-secret', path.join(stateRoot, 'mastery.hmac')),
        {
          label: 'mastery secret',
          expectedKeyId: value('--expected-mastery-key-id'),
        },
      ).secret;
      const verified = verifyMasteryState(mastery, masterySecret, selected);
      if (!verified.ok) throw new Error(`signed acquisition state failed verification: ${verified.errors.join('; ')}`);
      acquisitionStatus = buildAcquisitionStatus({ state: mastery, graph: selected.graph });
    }
    console.log(JSON.stringify(buildLayeredPhdStatus({
      program,
      acquisitionStatus,
      acquisitionStateVerified: mastery !== null,
      retentionStatus,
      retentionStatusVerified,
      campaignReport,
      campaignBundle,
      qualificationDeployment,
      qualificationSigningSecret: qualificationSecret,
    }), null, 2));
  } else {
    throw new Error(`unknown phd-control command: ${command}`);
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    command,
    blocker: error.message,
    truthBoundary: 'No retained-mastery or PhD capability claim is allowed.',
  }, null, 2));
  process.exitCode = 1;
}
