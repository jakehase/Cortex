import crypto from 'node:crypto';

import { AUDIT_LOG_PATH } from '../config.mjs';
import { appendNdjson, nowIso, readNdjson } from './storage.mjs';

function normalizeActor(actor = {}) {
  return {
    actor_id: String(actor.actor_id || 'system').trim() || 'system',
    role: String(actor.role || 'system').trim() || 'system'
  };
}

export function appendAuditEvent({ type, actor, subject = {}, details = {} }) {
  const event = {
    event_id: `audit_${crypto.randomUUID().replace(/-/g, '')}`,
    at: nowIso(),
    type,
    actor: normalizeActor(actor),
    subject,
    details
  };

  appendNdjson(AUDIT_LOG_PATH, event);
  return event;
}

export function listAuditEvents({ limit } = {}) {
  return readNdjson(AUDIT_LOG_PATH, { limit })
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}
