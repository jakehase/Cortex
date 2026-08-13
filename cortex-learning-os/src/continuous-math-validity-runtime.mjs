import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';

export const CONTINUOUS_MATH_VALIDITY_MODEL_RUNTIME = Object.freeze({
  provider: 'openai-codex',
  model: 'gpt-5.6-sol',
  thinking: 'ultra',
  serviceTier: 'fast',
  sandbox: 'read-only',
  toolsAllowed: false,
});

export function validateContinuousMathValidityModelRuntime(modelRuntime) {
  let ok = false;
  try {
    ok = canonicalJson(modelRuntime)
      === canonicalJson(CONTINUOUS_MATH_VALIDITY_MODEL_RUNTIME);
  } catch {
    ok = false;
  }
  return {
    ok,
    errors: ok ? [] : ['model runtime differs from the frozen continuous-math validity runtime'],
  };
}
