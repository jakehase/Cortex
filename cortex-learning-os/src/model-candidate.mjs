import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { canonicalJson } from '../../plugins/cortex-learning-os-live/registry.mjs';
import { observedToolEvents, extractJson } from './model-answer-runner.mjs';
import { sha256Text } from './hash.mjs';
import { CLOS_ROOT } from './paths.mjs';

const OUTPUT_KEYS = new Set(['rule', 'scope', 'contraindications', 'likelyRootCause']);

function normalized(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function positiveUsage(usage) {
  return usage && typeof usage === 'object' && !Array.isArray(usage)
    && Object.entries(usage).some(([key, value]) => /(?:input|output|total|token)/i.test(key) && Number(value) > 0);
}

function parseJsonLines(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { type: 'unparsed_output', text: line }; }
  });
}

export function buildCandidatePrompt({ concept, failedItem, attempt, verifier, correctionEvidence = [] } = {}) {
  if (verifier?.status !== 'failed' || verifier?.score !== 0 || verifier?.itemId !== failedItem?.itemId || attempt?.itemId !== failedItem?.itemId) {
    throw new Error('candidate synthesis requires a genuine linked deterministic failure');
  }
  const feedback = verifier.failureReason || 'The deterministic checker rejected the observed answer.';
  return [
    'You are proposing a bounded lesson candidate after an independently graded failure.',
    'Do not use tools. Do not reveal or state the answer to the failed item. Do not reproduce a fixed remediation template.',
    'Return only JSON with exactly: rule, scope, contraindications (array), likelyRootCause.',
    'The rule must be a general method applicable to fresh problems, with a narrow scope and concrete contraindications.',
    `Concept ID: ${concept.conceptId}`,
    `Declared outcome: ${concept.outcomes.join(' ')}`,
    `Failed prompt: ${failedItem.prompt}`,
    `Observed answer: ${String(attempt.answer).slice(0, 500)}`,
    `Verifier feedback: ${String(feedback).slice(0, 500)}`,
    `Bounded correction evidence: ${JSON.stringify(correctionEvidence).slice(0, 1500)}`,
  ].join('\n\n');
}

export function validateCandidateOutput({
  output,
  concept,
  failedItem,
  attempt,
  verifier,
  provenance,
  policy,
  fixedTemplates = [],
} = {}) {
  const errors = [];
  if (verifier?.status !== 'failed' || verifier?.score !== 0 || verifier?.itemId !== failedItem?.itemId || attempt?.itemId !== failedItem?.itemId) {
    errors.push('candidate lacks a genuine linked observed failure');
  }
  if (!output || typeof output !== 'object' || Array.isArray(output)
      || Object.keys(output).some((key) => !OUTPUT_KEYS.has(key)) || Object.keys(output).length !== OUTPUT_KEYS.size) {
    errors.push('candidate output must contain exactly the declared fields');
  }
  const limits = policy.candidate;
  for (const [field, maximum] of [['rule', limits.maximumRuleChars], ['scope', limits.maximumScopeChars], ['likelyRootCause', limits.maximumRootCauseChars]]) {
    if (typeof output?.[field] !== 'string' || output[field].trim().length < 1 || output[field].length > maximum) errors.push(`invalid candidate ${field}`);
  }
  if (!Array.isArray(output?.contraindications) || output.contraindications.length < 1
      || output.contraindications.length > limits.maximumContraindications
      || new Set(output.contraindications).size !== output.contraindications.length
      || output.contraindications.some((item) => typeof item !== 'string' || item.trim().length < 1 || item.length > limits.maximumContraindicationChars)) {
    errors.push('invalid candidate contraindications');
  }
  const joined = normalized([output?.rule, output?.scope, output?.likelyRootCause, ...(output?.contraindications || [])].join(' '));
  const ruleText = normalized(output?.rule);
  const contraindicationTexts = (output?.contraindications || []).map(normalized);
  for (const phrase of limits.prohibitedPhrases) {
    if (joined.includes(normalized(phrase))) errors.push(`candidate contains prohibited phrase: ${phrase}`);
  }
  const expected = normalized(failedItem?.checker?.expected);
  const observed = normalized(attempt?.answer);
  if (expected && (normalized(output?.rule) === expected || new RegExp(`\\b(?:answer|result)\\s+(?:is|=)\\s*${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(joined))) {
    errors.push('candidate leaks the failed expected answer');
  }
  if (observed && normalized(output?.rule) === observed) errors.push('candidate merely repeats the observed answer');
  if (/\b(?:always valid|without exception|ignore (?:all )?contraindications)\b/.test(ruleText)
      || contraindicationTexts.some((warning) => warning === ruleText || warning === `do not ${ruleText}`)) {
    errors.push('candidate rule contradicts its declared limitations');
  }
  for (const template of fixedTemplates) {
    const candidateRule = normalized(output?.rule);
    const fixed = normalized(template);
    if (fixed && (candidateRule === fixed || (fixed.length >= 40 && candidateRule.includes(fixed)))) errors.push('candidate copies a fixed remediation template');
  }
  if (!joined.includes(normalized(concept?.conceptId).split('-')[0]) && !normalized(output?.scope).includes(normalized(concept?.title))) {
    errors.push('candidate scope is not grounded in the selected concept');
  }
  if (!provenance || provenance.provider !== 'openai-codex' || typeof provenance.model !== 'string' || !provenance.model
      || !['codex_exec_ephemeral', 'test_fixture'].includes(provenance.kind)) errors.push('candidate provenance is incomplete');
  if (!positiveUsage(provenance?.usage)) errors.push('candidate has no positive model usage');
  if (!Array.isArray(provenance?.toolsUsed) || provenance.toolsUsed.length !== 0) errors.push('candidate synthesis observed tool use');
  if (!Number.isFinite(Number(provenance?.runtimeMs)) || Number(provenance.runtimeMs) < 0) errors.push('candidate runtime is invalid');
  return { ok: errors.length === 0, errors };
}

export function buildCandidateRecord({ output, concept, failedItem, attempt, verifier, provenance, prompt, policy, fixedTemplates = [], createdAt = new Date().toISOString() } = {}) {
  const validation = validateCandidateOutput({ output, concept, failedItem, attempt, verifier, provenance, policy, fixedTemplates });
  const promptDigest = sha256Text(prompt);
  const outputDigest = sha256Text(canonicalJson(output));
  const candidateId = `adaptive_candidate_${sha256Text(`${concept.conceptId}:${verifier.verifierResultId}:${outputDigest}`).slice(0, 20)}`;
  return {
    schemaVersion: 'cortex.learning_os.adaptive_candidate.v1',
    candidateId,
    createdAt,
    status: validation.ok ? 'validated' : 'quarantined',
    conceptId: concept.conceptId,
    failedItemId: failedItem.itemId,
    failureVerifierId: verifier.verifierResultId,
    rule: output?.rule || '',
    scope: output?.scope || '',
    contraindications: output?.contraindications || [],
    likelyRootCause: output?.likelyRootCause || '',
    provenance: {
      ...provenance,
      promptDigest,
      outputDigest,
    },
    validationErrors: validation.errors,
    truthBoundary: 'This is a model-derived bounded candidate, not a trusted lesson. It can be activated only after independent paired evaluation and control-plane replay.',
  };
}

export function runCodexCandidate({
  prompt,
  sessionId,
  model = 'gpt-5.6-sol',
  thinking = 'xhigh',
  codexCommand = 'codex',
  timeoutSeconds = 240,
} = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-adaptive-candidate-'));
  const outputPath = path.join(temporaryRoot, 'last-message.json');
  const schemaPath = path.join(CLOS_ROOT, 'schemas/adaptive-candidate-output.schema.json');
  const started = Date.now();
  try {
    const args = [
      'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only',
      '--skip-git-repo-check', '--model', model, '--config', `model_reasoning_effort="${thinking}"`,
      '--cd', temporaryRoot, '--json', '--output-schema', schemaPath, '--output-last-message', outputPath, '-',
    ];
    const result = spawnSync(codexCommand, args, {
      input: prompt,
      encoding: 'utf8',
      timeout: (timeoutSeconds + 30) * 1000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, CLOS_EXPERIMENT_SESSION_ID: sessionId, CLOS_THINKING: thinking },
    });
    const runtimeMs = Date.now() - started;
    const events = parseJsonLines(result.stdout);
    const toolEvents = observedToolEvents(events);
    const finalText = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    const raw = {
      command: codexCommand, args, exitCode: result.status, signal: result.signal,
      error: result.error?.message || null, stderr: result.stderr || '', events, finalText, sessionId,
    };
    if (result.error || result.status !== 0) throw Object.assign(new Error(result.error?.message || `candidate worker exited ${result.status}`), { workerRaw: raw });
    const output = extractJson(finalText);
    const usageEvent = [...events].reverse().find((event) => event?.usage || event?.item?.usage);
    return {
      output,
      raw,
      provenance: {
        kind: 'codex_exec_ephemeral',
        provider: 'openai-codex',
        model,
        sessionId,
        usage: usageEvent?.usage || usageEvent?.item?.usage || null,
        toolsUsed: toolEvents.map((event) => event?.item?.type || event?.type || 'unknown_tool'),
        runtimeMs,
      },
    };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
