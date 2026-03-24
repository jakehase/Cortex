import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';

type ReplyReliabilityConfig = {
  channels?: string[];
  maxAgeMs?: number;
  summaryMaxChars?: number;
};

type PendingInbound = {
  text: string;
  receivedAt: number;
};

const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;
const DEFAULT_SUMMARY_MAX_CHARS = 180;

const RATE_LIMIT_TEXT = '⚠️ API rate limit reached. Please try again later.';
const OVERLOADED_TEXT = 'The AI service is temporarily overloaded. Please try again in a moment.';
const GENERIC_ERROR_TEXT = 'The AI service returned an error. Please try again.';
const TIMEOUT_TEXT = 'LLM request timed out.';

function routeKey(channelId: string, accountId: string | undefined, conversationId: string | undefined, peer: string): string {
  return `${channelId}:${(accountId ?? 'default').trim() || 'default'}:${(conversationId ?? peer).trim() || peer}`;
}

function stripInternalEnvelope(text: string): string {
  return String(text || '')
    .replace(/Conversation info \(untrusted metadata\):\s*```[\s\S]*?```/gi, ' ')
    .replace(/Sender \(untrusted metadata\):\s*```[\s\S]*?```/gi, ' ')
    .replace(/Cortex upstream routing applied:[^\n]*/gi, ' ')
    .replace(/^\s*\[\[\s*reply_to:[^\]]+\]\]\s*/gim, '')
    .replace(/^\s*\[\[\s*reply_to_current\s*\]\]\s*/gim, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarize(text: string, maxChars: number): string {
  const cleaned = stripInternalEnvelope(text);
  if (!cleaned) return '';
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function classifyTransientFailure(text: string): 'rate_limit' | 'overloaded' | 'timeout' | 'generic' | null {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  if (normalized === RATE_LIMIT_TEXT) return 'rate_limit';
  if (normalized === OVERLOADED_TEXT) return 'overloaded';
  if (normalized === TIMEOUT_TEXT) return 'timeout';
  if (normalized === GENERIC_ERROR_TEXT) return 'generic';
  return null;
}

function buildContextualFallback(kind: NonNullable<ReturnType<typeof classifyTransientFailure>>, promptSummary: string): string {
  const quoted = promptSummary ? ` about: “${promptSummary}”` : '';
  switch (kind) {
    case 'rate_limit':
      return `I hit a model-side rate limit before I could answer your last message${quoted}. I wasn't ignoring you — the backend failed before I could produce a real reply. Try me again once capacity is back, and I’ll answer normally.`;
    case 'overloaded':
      return `The model backend overloaded before I could answer your last message${quoted}. I wasn't ignoring you — the reply failed upstream before it was generated. Give it another shot in a moment.`;
    case 'timeout':
      return `The model timed out before I could answer your last message${quoted}. I wasn't ignoring you — the run died before it could finish. Send it again and I’ll retry cleanly.`;
    case 'generic':
    default:
      return `I failed before I could answer your last message${quoted}. I wasn't ignoring you — the backend errored out before a reply was produced. Please send it again and I’ll pick it up from there.`;
  }
}

export default function register(api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig ?? {}) as ReplyReliabilityConfig;
  const allowedChannels = new Set((cfg.channels ?? ['whatsapp']).map((v) => String(v).trim()).filter(Boolean));
  const maxAgeMs = Math.max(1000, Math.trunc(cfg.maxAgeMs ?? DEFAULT_MAX_AGE_MS));
  const summaryMaxChars = Math.max(40, Math.trunc(cfg.summaryMaxChars ?? DEFAULT_SUMMARY_MAX_CHARS));
  const pendingInboundByRoute = new Map<string, PendingInbound>();

  api.on('message_received', (event, ctx) => {
    if (!allowedChannels.has(ctx.channelId)) return;
    const key = routeKey(ctx.channelId, ctx.accountId, ctx.conversationId, event.from);
    const cleaned = summarize(event.content ?? '', summaryMaxChars);
    if (!cleaned) return;
    pendingInboundByRoute.set(key, {
      text: cleaned,
      receivedAt: event.timestamp ?? Date.now(),
    });
  });

  api.on('message_sending', (event, ctx) => {
    if (!allowedChannels.has(ctx.channelId)) return;
    const key = routeKey(ctx.channelId, ctx.accountId, ctx.conversationId, event.to);
    const failureKind = classifyTransientFailure(event.content ?? '');
    if (!failureKind) return;

    const pending = pendingInboundByRoute.get(key);
    if (!pending) return;
    if (Date.now() - pending.receivedAt > maxAgeMs) return;

    const replacement = buildContextualFallback(failureKind, pending.text);
    api.logger.info?.(`reply-reliability: replaced ${failureKind} fallback for ${key}`);
    return { content: replacement };
  });

  api.on('message_sent', (event, ctx) => {
    if (!allowedChannels.has(ctx.channelId)) return;
    if (!event.success) return;
    const key = routeKey(ctx.channelId, ctx.accountId, ctx.conversationId, event.to);
    const failureKind = classifyTransientFailure(event.content ?? '');
    if (failureKind) return;
    pendingInboundByRoute.delete(key);
  });
}
