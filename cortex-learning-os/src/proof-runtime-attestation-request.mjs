#!/usr/bin/env node
import path from 'node:path';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { assertApprovedModelExecutableAtPath } from './approved-model-executable.mjs';
import {
  assertAuthorityBindings,
  readAuthorityJson,
  readAuthoritySecret,
  validateAuthorityExpectations,
} from './authority-input.mjs';
import { currentCommittedIdentity } from './git-product-source.mjs';
import {
  assertQualificationDeployment,
  deploymentBindingDigest,
} from './deployment-identity.mjs';
import {
  DEFAULT_PROOF_KERNEL_ROOT,
  buildProofRuntimeAttestationRequest,
  buildProofRuntimeAttestationPayload,
} from './lean-proof-preflight.mjs';
import { loadCanonicalPhdProgram } from './phd-program-runtime.mjs';
import { verifyQualificationLaunchPlan } from './phd-qualification-launch.mjs';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
};

try {
  const proofKernelRoot = path.resolve(value('--kernel-root') || DEFAULT_PROOF_KERNEL_ROOT);
  const leanRoot = value('--lean-root');
  const identity = currentCommittedIdentity({ requireClean: true });
  const program = loadCanonicalPhdProgram(identity);
  if (!program.ok || !program.productionTrustReady) {
    throw new Error([
      ...program.errors,
      ...program.productionTrustBlockers,
    ].join('; ') || 'committed production program is not ready');
  }
  const expectedAuthority = validateAuthorityExpectations({
    subjectId: value('--expected-subject-id'),
    campaignDigest: value('--expected-campaign-digest'),
    deploymentDigest: value('--expected-deployment-digest'),
    keyId: value('--expected-key-id'),
  });
  const signingSecret = readAuthoritySecret(value('--secret'), {
    label: 'qualification secret',
    expectedKeyId: expectedAuthority.keyId,
  }).secret;
  const observedAt = value('--now') || new Date().toISOString();
  const plan = readAuthorityJson(
    value('--plan'),
    'authenticated qualification plan',
    {
      consume(candidate) {
        assertAuthorityBindings({
          subjectId: candidate.subjectId,
          campaignDigest: candidate.campaignDigest,
          deploymentDigest: deploymentBindingDigest(candidate.deployment),
          keyId: candidate.controlPlaneSignature?.keyId,
        }, expectedAuthority, 'proof-runtime qualification plan');
        verifyQualificationLaunchPlan({
          plan: candidate,
          signingSecret,
          expectedSubjectId: expectedAuthority.subjectId,
          expectedCampaignDigest: expectedAuthority.campaignDigest,
          expectedDeploymentDigest: expectedAuthority.deploymentDigest,
          now: observedAt,
          authorization: 'archival_harvest',
        });
        return candidate;
      },
    },
  ).consumed;
  const deployment = assertQualificationDeployment(plan.deployment, program.deployment);
  assertApprovedModelExecutableAtPath(deployment.approvedModelExecutable);
  const payload = buildProofRuntimeAttestationPayload({
    proofKernelRoot,
    leanRoot: leanRoot ? path.resolve(leanRoot) : null,
    deployment,
    trustPolicy: program.trustPolicy,
  });
  process.stdout.write(canonicalJson(buildProofRuntimeAttestationRequest(payload)));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    blocker: error.message,
    truthBoundary: 'An incomplete or non-allowlisted proof runtime cannot request production authentication.',
  }));
  process.exitCode = 1;
}
