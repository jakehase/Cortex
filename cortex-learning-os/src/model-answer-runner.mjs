import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLOS_ROOT } from './paths.mjs';

export function extractJson(text) {
  const stripped = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('model response did not contain a JSON object');
  return JSON.parse(stripped.slice(start, end + 1));
}

function parseJsonLines(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    try { return JSON.parse(line); }
    catch { return { type: 'unparsed_output', text: line }; }
  });
}

export function observedToolEvents(events = []) {
  const toolTypes = new Set(['command_execution', 'mcp_tool_call', 'web_search', 'computer', 'tool_call', 'function_call']);
  return events.filter((event) => {
    const candidates = [event?.type, event?.item?.type, event?.name, event?.item?.name]
      .filter(Boolean).map((value) => String(value).toLowerCase());
    return candidates.some((value) => toolTypes.has(value)
      || ['tool_call', 'command_execution', 'web_search', 'mcp_tool', 'computer_call', 'shell_call'].some((marker) => value.includes(marker)));
  });
}

export function buildExamPrompt({ exam, learningContext = null } = {}) {
  const items = exam.items.map((item) => ({ itemId: item.itemId, prompt: item.prompt, answerFormat: item.answerFormat }));
  return [
    'You are taking a bounded, recorded math exam for Cortex Learning OS.',
    'Answer independently without tools. Return only valid JSON with shape {"answers":[{"itemId":"...","answer":"..."}]}.',
    'Give exactly one answer for every item. Do not include reasoning, markdown, commentary, or confidence.',
    learningContext ? `Learning context supplied for this run:\n${learningContext}` : 'No learning context is supplied for this baseline run.',
    `Exam title: ${exam.title}`,
    `Items:\n${JSON.stringify(items)}`
  ].join('\n\n');
}

export function parseAgentResult(raw, { runId, evidenceRole = 'exam', startedAt, completedAt } = {}) {
  const payloadText = raw?.result?.payloads?.[0]?.text;
  const parsed = extractJson(payloadText);
  if (!Array.isArray(parsed.answers)) throw new Error('model JSON must contain an answers array');
  const agent = raw?.result?.meta?.agentMeta || {};
  return {
    schemaVersion: 'cortex.learning_os.answer_set.v0',
    runId,
    answers: parsed.answers.map((row) => ({ itemId: String(row.itemId), answer: row.answer })),
    answerSource: {
      kind: 'openclaw_agent',
      provider: agent.provider || null,
      model: agent.model || null,
      gatewayRunId: raw.runId || null,
      sessionId: agent.sessionId || null,
      usage: agent.usage || null
    },
    evidenceRole,
    toolsUsed: [],
    startedAt,
    completedAt
  };
}

export function runOpenClawExam({ exam, sessionId, runId, learningContext = null, evidenceRole = 'exam', timeoutSeconds = 180, thinking = 'off' } = {}) {
  const prompt = buildExamPrompt({ exam, learningContext });
  const startedAt = new Date().toISOString();
  const stdout = execFileSync('openclaw', [
    'agent', '--session-id', sessionId, '--message', prompt, '--thinking', thinking,
    '--json', '--timeout', String(timeoutSeconds)
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: (timeoutSeconds + 30) * 1000 });
  const completedAt = new Date().toISOString();
  const raw = JSON.parse(stdout);
  if (raw.status !== 'ok') throw new Error(`OpenClaw agent run failed: ${raw.status || 'unknown'}`);
  return {
    raw,
    prompt,
    answerSet: parseAgentResult(raw, { runId, evidenceRole, startedAt, completedAt })
  };
}

export function runCodexExam({
  exam,
  sessionId,
  runId,
  learningContext = null,
  evidenceRole = 'ab_retest',
  timeoutSeconds = 240,
  thinking = 'low',
  model = 'gpt-5.6-sol',
  codexCommand = 'codex'
} = {}) {
  if (!['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(thinking)) throw new Error(`unsupported Codex reasoning effort: ${thinking}`);
  const prompt = buildExamPrompt({ exam, learningContext });
  const startedAt = new Date().toISOString();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clos-codex-exam-'));
  const lastMessagePath = path.join(temporaryRoot, 'last-message.json');
  const schemaPath = path.join(CLOS_ROOT, 'schemas/model-answer-output.schema.json');
  let result;
  try {
    const args = [
      'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only',
      '--skip-git-repo-check', '--model', model, '--config', `model_reasoning_effort="${thinking}"`, '--cd', temporaryRoot, '--json',
      '--output-schema', schemaPath, '--output-last-message', lastMessagePath, '-'
    ];
    result = spawnSync(codexCommand, args, {
      input: prompt,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: (timeoutSeconds + 30) * 1000,
      env: { ...process.env, CLOS_EXPERIMENT_SESSION_ID: sessionId, CLOS_THINKING: thinking }
    });
    const completedAt = new Date().toISOString();
    const events = parseJsonLines(result.stdout);
    const toolEvents = observedToolEvents(events);
    const finalText = fs.existsSync(lastMessagePath) ? fs.readFileSync(lastMessagePath, 'utf8') : '';
    const raw = {
      command: codexCommand,
      args,
      exitCode: result.status,
      signal: result.signal,
      error: result.error?.message || null,
      stderr: result.stderr || '',
      events,
      finalText,
      sessionId
    };
    if (result.error) throw Object.assign(new Error(`Codex worker failed: ${result.error.message}`), { workerRaw: raw });
    if (result.status !== 0) throw Object.assign(new Error(`Codex worker exited with code ${result.status}`), { workerRaw: raw });
    let parsed;
    try {
      parsed = extractJson(finalText);
    } catch (error) {
      throw Object.assign(new Error(`model response was not valid JSON: ${error.message}`), { workerRaw: raw });
    }
    if (!Array.isArray(parsed.answers)) throw Object.assign(new Error('model JSON must contain an answers array'), { workerRaw: raw });
    if (parsed.answers.some((row) => !row || typeof row !== 'object' || !Object.hasOwn(row, 'itemId') || !Object.hasOwn(row, 'answer'))) {
      throw Object.assign(new Error('every model answer must contain itemId and answer'), { workerRaw: raw });
    }
    const usageEvent = [...events].reverse().find((event) => event?.usage || event?.item?.usage);
    const answerSet = {
      schemaVersion: 'cortex.learning_os.answer_set.v0',
      runId,
      answers: parsed.answers.map((row) => ({ itemId: String(row.itemId), answer: row.answer })),
      answerSource: {
        kind: 'codex_exec_ephemeral',
        provider: 'openai-codex',
        model,
        gatewayRunId: null,
        sessionId,
        usage: usageEvent?.usage || usageEvent?.item?.usage || null
      },
      evidenceRole,
      toolsUsed: toolEvents.map((event) => event?.item?.type || event?.type || 'unknown_tool'),
      startedAt,
      completedAt
    };
    return { raw, prompt, answerSet, toolEvents };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
