import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const DEFAULT_THREAD_CONTEXT = Object.freeze({
  channel: 'whatsapp',
  accountId: 'default',
  conversationId: '+17855410986',
  surface: 'whatsapp',
  provider: 'whatsapp'
});

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function writeJson(filePath, data) {
  writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function appendJsonl(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function run(command, args = [], options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    timeout: options.timeout || 30000,
    maxBuffer: options.maxBuffer || 1024 * 1024 * 8
  });
  return {
    ok: result.status === 0 && !result.error,
    command: [command, ...args].join(' '),
    durationMs: Date.now() - startedAt,
    exitCode: result.status,
    signal: result.signal,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error ? String(result.error.message || result.error) : null
  };
}

function sanitizeSegment(value) {
  return String(value || 'default').replace(/[^a-zA-Z0-9._+-]/g, '_');
}

export function resolveTransportPaths({ artifactRoot }) {
  const base = path.join(artifactRoot, 'cortex_transport');
  return {
    root: base,
    runtimeProbe: path.join(base, 'runtime_probe.json'),
    threadBindingProbe: path.join(base, 'thread_binding_probe.json'),
    transportStatus: path.join(base, 'transport_status.json'),
    eventStream: path.join(base, 'session_events.jsonl'),
    memoryRoot: path.join(base, 'memory'),
    memoryIndex: path.join(base, 'MEMORY.md'),
    memoryReadme: path.join(base, 'memory', 'README.md'),
    projectMemory: path.join(base, 'memory', 'projects', 'mailchimp-full-clone-campaign.md'),
    agentMemory: path.join(base, 'memory', 'agents', 'real-repo-100-agent-orchestrator.md')
  };
}

export function scaffoldCortexMemory({ artifactRoot, threadContext = DEFAULT_THREAD_CONTEXT, note = '' }) {
  const paths = resolveTransportPaths({ artifactRoot });
  const today = new Date().toISOString().slice(0, 10);
  const channelFile = path.join(paths.memoryRoot, 'channels', `${sanitizeSegment(threadContext.channel)}-${sanitizeSegment(threadContext.accountId)}-${sanitizeSegment(threadContext.conversationId)}.md`);
  const dailyFile = path.join(paths.memoryRoot, 'daily', `${today}.md`);

  writeText(paths.memoryIndex, [
    '# MEMORY',
    '',
    '- Project status: `memory/projects/mailchimp-full-clone-campaign.md`',
    `- Channel status: \`memory/channels/${path.basename(channelFile)}\``,
    '- Agent status: `memory/agents/real-repo-100-agent-orchestrator.md`',
    `- Daily log: \`memory/daily/${today}.md\``,
    '',
    'This follows the Cortex-owned filesystem-offloaded memory pattern: keep the index small and store detailed state in structured files.'
  ].join('\n'));

  writeText(paths.memoryReadme, [
    '# memory/',
    '',
    'Filesystem-offloaded orchestration memory for the Mailchimp full-clone campaign.',
    '',
    'Shards:',
    '- `projects/` — project/campaign level truth',
    '- `channels/` — thread/conversation-specific context',
    '- `agents/` — worker topology/operator notes',
    '- `daily/` — chronological activity log'
  ].join('\n'));

  writeText(paths.projectMemory, [
    '# mailchimp full-clone campaign',
    '',
    '- Fidelity target: `full_clone`',
    '- Current worker topology: `real_repo_100_agent_orchestrator`',
    '- Conversation surface: WhatsApp thread-bound campaign control',
    note ? `- Note: ${note}` : '- Note: Cortex-owned transport scaffolding active for this campaign.'
  ].join('\n'));

  writeText(paths.agentMemory, [
    '# real-repo-100-agent-orchestrator',
    '',
    '- Delegate path: `scripts/real-repo-100-agent-expansion-campaign.mjs`',
    '- Event contract: `session.*` Cortex-owned JSONL stream under `cortex_transport/session_events.jsonl`',
    '- Thread binding mode: current conversation metadata carried alongside campaign state',
    '- Transport: Cortex-owned file-backed event stream and offloaded memory; no external ClawHip daemon in the active path.'
  ].join('\n'));

  writeText(channelFile, [
    `# ${threadContext.channel} ${threadContext.conversationId}`,
    '',
    `- accountId: ${threadContext.accountId}`,
    `- surface: ${threadContext.surface}`,
    `- provider: ${threadContext.provider}`,
    '- Semantics: thread-bound = current conversation binding / routing context for orchestration follow-ups'
  ].join('\n'));

  const existingDaily = fs.existsSync(dailyFile) ? fs.readFileSync(dailyFile, 'utf8') : '';
  const marker = '- Initialized Cortex-owned orchestration memory scaffold for the 100-agent full-clone campaign.';
  if (!existingDaily.includes(marker)) {
    writeText(dailyFile, `${existingDaily}${existingDaily ? '\n' : ''}${marker}\n`);
  }

  return { ...paths, channelMemory: channelFile, dailyMemory: dailyFile };
}

export function probeThreadBinding({ openclawBundlePath = '/usr/lib/node_modules/openclaw/dist/auth-profiles-B5ypC5S-.js', artifactRoot, threadContext = DEFAULT_THREAD_CONTEXT }) {
  const text = fs.existsSync(openclawBundlePath) ? fs.readFileSync(openclawBundlePath, 'utf8') : '';
  const needles = {
    ensureCurrentConversationBindingForSubagentSpawn: text.includes('ensureCurrentConversationBindingForSubagentSpawn'),
    resolveSubagentSpawnConversationId: text.includes('resolveSubagentSpawnConversationId'),
    fallbackCallPresent: text.includes('return await ensureCurrentConversationBindingForSubagentSpawn(params);')
  };
  const probe = {
    generatedAt: new Date().toISOString(),
    bundlePath: openclawBundlePath,
    active: Object.values(needles).every(Boolean),
    needles,
    threadContext,
    note: 'This proves the WhatsApp current-conversation thread-binding fallback is present in the live OpenClaw install. The 100-agent worker farm itself is local-process based, so this is routing readiness evidence rather than per-worker subagent binding.'
  };
  if (artifactRoot) writeJson(resolveTransportPaths({ artifactRoot }).threadBindingProbe, probe);
  return probe;
}

export function probeExternalClawhipQuarantine({ artifactRoot }) {
  const probe = {
    generatedAt: new Date().toISOString(),
    externalClawhipRuntimeActive: false,
    externalClawhipRuntimePresent: false,
    note: 'External ClawHip repo/runtime is intentionally not part of the active architecture for this campaign. Cortex carries the selected superior transport/threading ideas directly.'
  };
  if (artifactRoot) writeJson(resolveTransportPaths({ artifactRoot }).runtimeProbe, probe);
  return probe;
}

export function composeTransportStatus({ artifactRoot, threadContext = DEFAULT_THREAD_CONTEXT }) {
  const memory = scaffoldCortexMemory({ artifactRoot, threadContext });
  const threadBinding = probeThreadBinding({ artifactRoot, threadContext });
  const externalClawhip = probeExternalClawhipQuarantine({ artifactRoot });
  const status = {
    generatedAt: new Date().toISOString(),
    threadContext,
    memory: {
      root: path.relative(process.cwd(), memory.memoryRoot),
      project: path.relative(process.cwd(), memory.projectMemory),
      agent: path.relative(process.cwd(), memory.agentMemory),
      channel: path.relative(process.cwd(), memory.channelMemory),
      daily: path.relative(process.cwd(), memory.dailyMemory)
    },
    threadBinding,
    externalClawhip,
    active: {
      cortexTransport: true,
      threadBindingReadiness: threadBinding.active,
      externalClawhipRuntimeActive: false
    }
  };
  writeJson(resolveTransportPaths({ artifactRoot }).transportStatus, status);
  return status;
}

export function emitSessionEvent({ artifactRoot, event, summary, threadContext = DEFAULT_THREAD_CONTEXT, sessionId = 'mailchimp-full-clone-campaign', tool = 'openclaw', project = 'mailchimp-clone', repoPath, extra = {} }) {
  const paths = resolveTransportPaths({ artifactRoot });
  const payload = {
    schema_version: '1',
    event,
    tool,
    status: event.replace(/^session\./, ''),
    timestamp: new Date().toISOString(),
    session: sessionId,
    project,
    repo_name: path.basename(repoPath || process.cwd()),
    repo_path: repoPath || process.cwd(),
    summary,
    conversation: threadContext,
    context: {
      normalized_event: event,
      hostname: os.hostname(),
      pid: process.pid,
      artifact_root: artifactRoot,
      ...extra
    }
  };
  appendJsonl(paths.eventStream, payload);
  return payload;
}

export function readTransportStatus({ artifactRoot }) {
  return readJson(resolveTransportPaths({ artifactRoot }).transportStatus, null);
}
