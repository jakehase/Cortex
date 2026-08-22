import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import {
  assertModelQualificationDeployment,
  assertQualificationDeployment,
  MODEL_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA,
  sourceDeploymentBinding,
} from './deployment-identity.mjs';
import { validatePhdTrustPolicy } from './phd-trust.mjs';
import { retentionResumeBindingErrors } from './retention-resume-binding.mjs';

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function containsFixtureEvidence(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Object.hasOwn(value, 'fixtureOnly') && value.fixtureOnly !== false) return true;
  return Object.values(value).some((child) => containsFixtureEvidence(child, seen));
}

function differs(left, right) {
  return canonicalJson(left) !== canonicalJson(right);
}

function deploymentSourceDiffers(candidate, canonicalDeployment) {
  try {
    return differs(sourceDeploymentBinding(candidate), canonicalDeployment);
  } catch {
    return true;
  }
}

const COMMAND_POLICY_BINDINGS = new Map([
  ['acquisition-receipt', 'acquisitionPolicy'],
  ['retention-task', 'retentionPolicy'],
  ['retention-release', 'retentionPolicy'],
  ['retention-grade', 'retentionPolicy'],
  ['retention-status', 'retentionPolicy'],
  ['retention-resume', 'retentionPolicy'],
]);

function validateCommandPolicyBinding(bundle, canonicalProgram, command) {
  const errors = [];
  const canonicalField = COMMAND_POLICY_BINDINGS.get(command);
  if (canonicalField === undefined) {
    if (Object.hasOwn(bundle, 'policy')
        && differs(bundle.policy, canonicalProgram?.acquisitionPolicy)) {
      errors.push('control bundle policy differs from exact committed program');
    }
    return errors;
  }
  if (!Object.hasOwn(bundle, 'policy')) {
    errors.push(
      `production ${command} requires one exact canonical policy field`,
    );
  } else if (differs(bundle.policy, canonicalProgram?.[canonicalField])) {
    errors.push(
      `control bundle policy differs from exact committed program ${
        canonicalField === 'acquisitionPolicy' ? 'acquisition' : 'retention'
      } policy`,
    );
  }
  const aliases = ['acquisitionPolicy', 'retentionPolicy'].filter((field) => (
    Object.hasOwn(bundle, field)
  ));
  if (aliases.length > 0) {
    errors.push(
      `production ${command} policy is ambiguous: use only policy; forbidden aliases: ${
        aliases.join(', ')
      }`,
    );
  }
  return errors;
}

export function validateProductionControlBundle({
  bundle,
  canonicalProgram,
  command = null,
  retentionWait = null,
} = {}) {
  const errors = [];
  if (!isRecord(bundle)) return { ok: false, errors: ['control bundle must be an object'] };
  if (canonicalProgram?.ok !== true) errors.push('canonical committed PhD program is invalid');
  const allowedSourceModes = command === 'retention-resume'
    ? ['exact_git_blobs', 'signed_immutable_checkout']
    : ['exact_git_blobs'];
  if (!allowedSourceModes.includes(canonicalProgram?.sourceMode)) {
    errors.push(
      command === 'retention-resume'
        ? 'canonical program sourceMode must be exact_git_blobs or signed_immutable_checkout'
        : 'canonical program sourceMode must be exact_git_blobs',
    );
  }
  const trustValidation = validatePhdTrustPolicy(canonicalProgram?.trustPolicy, {
    requireProduction: true,
  });
  errors.push(...trustValidation.errors.map((error) => `production trust: ${error}`));
  if (containsFixtureEvidence(bundle)) {
    errors.push('production control bundle contains fixture-only evidence');
  }
  if (Object.hasOwn(bundle, 'dryRun') && bundle.dryRun !== false) {
    errors.push('production control bundle must omit dryRun or set it to exactly false');
  }
  if (deploymentSourceDiffers(bundle.expectedDeployment, canonicalProgram?.deployment)) {
    errors.push('control bundle expectedDeployment differs from exact committed deployment source identity');
  }
  const modelOnlyRetention = String(command || '').startsWith('retention-')
    && bundle.expectedDeployment?.schemaVersion
      === MODEL_EXECUTABLE_DEPLOYMENT_BINDING_SCHEMA;
  try {
    if (modelOnlyRetention) {
      assertModelQualificationDeployment(
        bundle.expectedDeployment,
        canonicalProgram?.deployment,
      );
    } else {
      assertQualificationDeployment(
        bundle.expectedDeployment,
        canonicalProgram?.deployment,
      );
    }
  } catch (error) {
    errors.push(`control bundle qualification deployment is invalid: ${error.message}`);
  }
  if (isRecord(bundle.campaign)
      && (modelOnlyRetention
        ? deploymentSourceDiffers(bundle.expectedDeployment, bundle.campaign.deployment)
        : differs(bundle.expectedDeployment, bundle.campaign.deployment))) {
    errors.push('control bundle expectedDeployment differs from the signed campaign deployment');
  }
  if (isRecord(bundle.deployment)
      && (modelOnlyRetention
        ? differs(sourceDeploymentBinding(bundle.expectedDeployment), bundle.deployment)
        : differs(bundle.expectedDeployment, bundle.deployment))) {
    errors.push('control bundle expectedDeployment differs from its qualification deployment');
  }
  errors.push(...validateCommandPolicyBinding(bundle, canonicalProgram, command));
  if (command === 'retention-resume') {
    errors.push(...retentionResumeBindingErrors({
      bundle,
      wait: retentionWait,
    }));
  }
  for (const [field, expected] of [
    ['deployment', canonicalProgram?.deployment],
    ['graph', canonicalProgram?.graph],
    ['rubric', canonicalProgram?.rubric],
    ['blueprint', canonicalProgram?.blueprint],
    ['proofRegistry', canonicalProgram?.proofRegistry],
    ['trustPolicy', canonicalProgram?.trustPolicy],
    ['acquisitionPolicy', canonicalProgram?.acquisitionPolicy],
    ['retentionPolicy', canonicalProgram?.retentionPolicy],
    ['programDigests', canonicalProgram?.program?.digests],
  ]) {
    if (Object.hasOwn(bundle, field)
        && (field === 'deployment'
          ? deploymentSourceDiffers(bundle[field], expected)
          : differs(bundle[field], expected))) {
      errors.push(`control bundle ${field} differs from exact committed program`);
    }
  }
  if (Object.hasOwn(bundle, 'program')
      && (bundle.program?.ok !== true
        || differs(bundle.program?.digests, canonicalProgram?.program?.digests))) {
    errors.push('control bundle program result differs from exact committed validation');
  }
  for (const [label, record] of [
    ['campaign', bundle.campaign],
    ['retention task', bundle.task],
  ]) {
    if (!isRecord(record)) continue;
    if (record.deployment
        && deploymentSourceDiffers(record.deployment, canonicalProgram?.deployment)) {
      errors.push(`${label} deployment differs from exact committed deployment`);
    }
    if (record.trustPolicy && differs(record.trustPolicy, canonicalProgram?.trustPolicy)) {
      errors.push(`${label} trust policy differs from exact committed trust policy`);
    }
  }
  if (command === 'acquisition-receipt' && !isRecord(bundle.assessmentBank)) {
    errors.push('production acquisition receipt requires exact signed assessment bank bytes');
  }
  if (command === 'retention-task' && !isRecord(bundle.campaignBinding)) {
    errors.push('production retention task requires the exact campaign binding');
  }
  if (command === 'retention-jobs-build'
      && (!isRecord(bundle.task)
        || !isRecord(bundle.release)
        || !isRecord(bundle.campaignBinding)
        || differs(bundle.campaignBinding, bundle.task?.assessmentCampaign))) {
    errors.push('production retention job build requires the exact task, release, and task campaign binding');
  }
  if (command === 'retention-status') {
    if (!Array.isArray(bundle.windows)
        || !Array.isArray(bundle.assessmentBanks)
        || bundle.assessmentBanks.length !== bundle.windows.length
        || !isRecord(bundle.graph) || !isRecord(bundle.rubric)
        || !isRecord(bundle.campaignBinding)) {
      errors.push('production retention status requires every window, exact signed bank, graph, rubric, and campaign binding');
    }
  }
  if (command === 'campaign-verify') {
    if (!isRecord(bundle.acquisitionReceipt?.assessmentBank)) {
      errors.push('production campaign verification requires acquisition receipt signed bank bytes');
    }
    if (!Array.isArray(bundle.retentionWindows) || bundle.retentionWindows.length !== 2
        || !Array.isArray(bundle.retentionAssessmentBanks)
        || bundle.retentionAssessmentBanks.length !== 2
        || !isRecord(bundle.graph) || !isRecord(bundle.rubric)
        || !isRecord(bundle.retentionPolicy)) {
      errors.push('production campaign verification requires two retention windows, two signed banks, graph, rubric, and retention policy');
    }
  }
  if ([
    'exam-assemble',
    'proof-assemble',
    'proof-replay',
    'research-assemble',
    'retention-grade',
    'retention-status',
    'campaign-verify',
  ].includes(command)
      && (!isRecord(bundle.qualificationPlan)
        || !isRecord(bundle.harvestState)
        || !isRecord(bundle.artifactManifestBytesByJob)
        || !isRecord(bundle.artifactFileBytesByJob))) {
    errors.push('production qualification assembly requires the exact protected plan, signed harvest state, manifest bytes, and complete terminal artifact byte set');
  }
  return { ok: errors.length === 0, errors };
}
