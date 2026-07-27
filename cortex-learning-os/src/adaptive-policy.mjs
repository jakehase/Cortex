import fs from 'node:fs';
import path from 'node:path';

import { sha256Text } from './hash.mjs';
import { CLOS_ROOT } from './paths.mjs';
import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';

export const DEFAULT_ADAPTIVE_POLICY_PATH = path.join(CLOS_ROOT, 'policies/adaptive-math-v0.8.json');
const RUNTIME_KEYS = ['model', 'provider', 'sandbox', 'thinking', 'toolsAllowed'];
const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateAdaptivePlanRuntime(policy, runtime) {
  const baseline = policy?.modelRuntime;
  return isRecord(runtime)
    && Object.keys(runtime).sort().join(',') === RUNTIME_KEYS.slice().sort().join(',')
    && runtime.provider === 'openai-codex'
    && runtime.provider === baseline?.provider
    && runtime.model === baseline?.model
    && runtime.sandbox === 'read-only'
    && runtime.sandbox === baseline?.sandbox
    && runtime.toolsAllowed === false
    && runtime.toolsAllowed === baseline?.toolsAllowed
    && REASONING_EFFORTS.includes(runtime.thinking)
    && REASONING_EFFORTS.indexOf(runtime.thinking) >= REASONING_EFFORTS.indexOf(baseline?.thinking);
}

export function validateAdaptivePolicy(policy) {
  const errors = [];
  if (!isRecord(policy)) return { ok: false, errors: ['policy must be an object'] };
  if (policy.schemaVersion !== 'cortex.learning_os.adaptive_policy.v1') errors.push('invalid policy schemaVersion');
  for (const field of ['policyId', 'curriculumId', 'capsuleId']) {
    if (typeof policy[field] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(policy[field])) errors.push(`invalid ${field}`);
  }
  if (!Array.isArray(policy.spacingDays) || policy.spacingDays.length !== 5
      || policy.spacingDays.some((value, index) => !Number.isInteger(value) || value < 0 || (index > 0 && value <= policy.spacingDays[index - 1]))) {
    errors.push('spacingDays must be [0, increasing positive stages]');
  }
  const budgets = policy.budgets;
  for (const [field, minimum, maximum] of [
    ['maxSteps', 1, 100],
    ['maxModelCalls', 1, 500],
    ['maxAttemptsPerConcept', 1, 20],
    ['maxArtifactFiles', 1, 10_000],
    ['maxArtifactBytes', 1_024, 1024 * 1024 * 1024],
  ]) {
    if (!Number.isInteger(budgets?.[field]) || budgets[field] < minimum || budgets[field] > maximum) errors.push(`invalid budgets.${field}`);
  }
  const paired = policy.pairedEvaluation;
  if (!Number.isInteger(paired?.pairCount) || paired.pairCount < 1 || paired.pairCount > 100) errors.push('invalid pairedEvaluation.pairCount');
  if (!Number.isInteger(paired?.minimumValidPairs) || paired.minimumValidPairs < 1 || paired.minimumValidPairs > paired?.pairCount) errors.push('invalid pairedEvaluation.minimumValidPairs');
  for (const field of ['minimumCandidateAccuracy', 'minimumAbsoluteLift', 'maximumExactMcNemarP']) {
    if (!Number.isFinite(paired?.[field]) || paired[field] < 0 || paired[field] > 1) errors.push(`invalid pairedEvaluation.${field}`);
  }
  if (!Number.isInteger(paired?.maximumNoCandidateOnlyRegressions) || paired.maximumNoCandidateOnlyRegressions < 0) {
    errors.push('invalid pairedEvaluation.maximumNoCandidateOnlyRegressions');
  }
  if (!Array.isArray(policy.prerequisiteGate?.allowedStates)
      || policy.prerequisiteGate.allowedStates.some((state) => !['review', 'mastered'].includes(state))) errors.push('invalid prerequisiteGate.allowedStates');
  if (!Number.isInteger(policy.prerequisiteGate?.minimumConsecutivePasses)
      || policy.prerequisiteGate.minimumConsecutivePasses < 1 || policy.prerequisiteGate.minimumConsecutivePasses > 10) {
    errors.push('invalid prerequisiteGate.minimumConsecutivePasses');
  }
  if (typeof policy.prerequisiteGate?.overduePassesGate !== 'boolean') errors.push('invalid prerequisiteGate.overduePassesGate');
  if (!Number.isInteger(policy.lapse?.resetReviewStage) || policy.lapse.resetReviewStage < 0
      || policy.lapse.resetReviewStage >= policy.spacingDays?.length) errors.push('invalid lapse.resetReviewStage');
  if (typeof policy.lapse?.scheduleImmediateRepair !== 'boolean') errors.push('invalid lapse.scheduleImmediateRepair');
  const runtime = policy.modelRuntime;
  if (runtime?.provider !== 'openai-codex' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(runtime?.model || ''))
      || !REASONING_EFFORTS.includes(runtime?.thinking)
      || runtime?.sandbox !== 'read-only' || runtime?.toolsAllowed !== false) errors.push('invalid modelRuntime');
  if (!Number.isInteger(policy.lessonExpiryDays) || policy.lessonExpiryDays < 1 || policy.lessonExpiryDays > 365) errors.push('invalid lessonExpiryDays');
  return { ok: errors.length === 0, errors };
}

export function policyDigest(policy) {
  const validation = validateAdaptivePolicy(policy);
  if (!validation.ok) throw new Error(`invalid adaptive policy: ${validation.errors.join('; ')}`);
  return sha256Text(canonicalJson(policy));
}

export function loadAdaptivePolicy(filePath = DEFAULT_ADAPTIVE_POLICY_PATH) {
  const target = path.resolve(filePath);
  const policy = JSON.parse(fs.readFileSync(target, 'utf8'));
  const digest = policyDigest(policy);
  return { policy, digest, path: target };
}
