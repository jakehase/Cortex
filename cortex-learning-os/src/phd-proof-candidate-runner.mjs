import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { observedToolEvents } from './model-answer-runner.mjs';
import {
  createProofCandidate,
  parseProofRecordBytes,
  serializeProofRecord,
} from './lean-proof-verifier.mjs';
import { sha256Text } from './hash.mjs';
import { CLOS_ROOT } from './paths.mjs';

function parseEvents(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { type: 'unparsed_output', text: line }; }
  });
}

function providerUsage(events) {
  return [...events].reverse()
    .map((event) => event?.usage || event?.item?.usage)
    .find((usage) => usage && typeof usage === 'object') || null;
}

function positiveUsage(usage) {
  return usage && Object.entries(usage).some(([key, value]) => (
    /(?:token|input|output|total)/i.test(key) && Number(value) > 0
  ));
}

export function runDetachedProofCandidate({
  taskBytes,
  candidateId,
  sessionId,
  model = 'gpt-5.6-sol',
  thinking = 'xhigh',
  codexCommand = 'codex',
  timeoutSeconds = 600,
} = {}) {
  const taskEnvelope = parseProofRecordBytes(taskBytes, 'proof task');
  if (thinking !== 'xhigh') throw new Error('qualification proof candidate requires xhigh reasoning');
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(sessionId)) {
    throw new Error('invalid proof candidate session identity');
  }
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-proof-candidate-'));
  const lastMessagePath = path.join(temporaryRoot, 'candidate.json');
  const schemaPath = path.join(CLOS_ROOT, 'schemas/proof-candidate-output.schema.json');
  const prompt = [
    'Produce a Lean 4 proof term for the exact trusted task below.',
    'Do not use tools, imports, directives, declarations, sorry, admit, axioms, file paths, processes, or environment access.',
    'Return only JSON matching {"proofTerm":"..."}; the term will be inserted into one parenthesized hole and replayed independently.',
    `Exact deterministic task bytes (base64): ${Buffer.from(taskBytes).toString('base64')}`,
  ].join('\n\n');
  try {
    const args = [
      'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules',
      '--sandbox', 'read-only', '--skip-git-repo-check',
      '--model', model, '--config', `model_reasoning_effort="${thinking}"`,
      '--cd', temporaryRoot, '--json',
      '--output-schema', schemaPath,
      '--output-last-message', lastMessagePath,
      '-',
    ];
    const startedAt = new Date().toISOString();
    const result = spawnSync(codexCommand, args, {
      input: prompt,
      encoding: 'utf8',
      timeout: (timeoutSeconds + 30) * 1000,
      maxBuffer: 32 * 1024 * 1024,
      env: {
        LANG: 'C',
        LC_ALL: 'C',
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        CLOS_QUALIFICATION_SESSION_ID: sessionId,
      },
    });
    const completedAt = new Date().toISOString();
    const events = parseEvents(result.stdout);
    const toolEvents = observedToolEvents(events);
    const usage = providerUsage(events);
    if (result.error || result.status !== 0) throw new Error(`proof candidate process failed: ${result.error?.message || result.status}`);
    if (toolEvents.length) throw new Error('proof candidate observed forbidden tool use');
    if (!positiveUsage(usage)) throw new Error('proof candidate lacks positive provider usage');
    const outputBytes = fs.readFileSync(lastMessagePath);
    const output = JSON.parse(outputBytes.toString('utf8'));
    if (!output || Object.keys(output).length !== 1 || typeof output.proofTerm !== 'string') {
      throw new Error('proof candidate output schema mismatch');
    }
    const candidate = createProofCandidate({
      taskBytes,
      candidateId,
      proofTerm: output.proofTerm,
    });
    const candidateBytes = serializeProofRecord(candidate);
    return {
      schemaVersion: 'cortex.learning_os.detached_proof_candidate_run.v1',
      taskBytesSha256: taskEnvelope.bytesSha256,
      candidate,
      candidateBytes,
      execution: {
        provider: 'openai-codex',
        model,
        thinking,
        sessionId,
        sandbox: 'read-only',
        toolsAllowed: false,
        toolsUsed: [],
        usage,
        positiveUsage: true,
        isolatedDirectory: true,
        exactTaskBytesSupplied: true,
        taskBytesSha256: taskEnvelope.bytesSha256,
        candidateBytesSha256: sha256Text(candidateBytes),
        outputSha256: sha256Text(outputBytes),
        promptSha256: sha256Text(prompt),
        startedAt,
        completedAt,
        exitCode: result.status,
      },
      truthBoundary: 'This is candidate output only. Qualification requires independent pinned-Lean acceptance and replay.',
    };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
