import { execFileSync } from 'node:child_process';

function extractJson(text) {
  const stripped = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('model response did not contain a JSON object');
  return JSON.parse(stripped.slice(start, end + 1));
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
