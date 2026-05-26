import { createId, nowIso } from '../app/index.mjs';

export const CONVERSATION_INBOX_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'conversation_inbox_sla_assignment_runtime_layer',
  label: 'Conversation inbox SLA, assignment, macro, and automation handoff runtime',
  controls: [
    'sla_policy_event_ledger',
    'thread_assignment_history',
    'reply_macro_application_ledger',
    'automation_handoff_events',
    'conversation_runtime_snapshots',
    'workspace_conversation_runtime_api'
  ],
  evidenceContract: [
    'thread_status_and_sla_rollups',
    'assignment_owner_changes',
    'macro_replies_persisted_to_timeline',
    'automation_handoff_payloads',
    'normal_inbox_route_adoption'
  ]
});

function ensureInbox(db) {
  db.conversations ||= [];
  db.conversationMessages ||= [];
  db.conversationRuntimeSnapshots ||= [];
  db.conversationSlaEvents ||= [];
  db.conversationAssignments ||= [];
  db.conversationMacros ||= [];
  db.conversationAutomationHandoffs ||= [];
}

function cleanList(value = '') {
  return String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
}

function priorityMinutes(priority = 'normal') {
  return priority === 'urgent' ? 60 : priority === 'high' ? 240 : 1440;
}

function sentimentFor(text = '') {
  const value = String(text || '').toLowerCase();
  if (/angry|cancel|refund|bad|broken|urgent|frustrated/.test(value)) return 'negative';
  if (/thanks|great|love|helpful|resolved/.test(value)) return 'positive';
  return 'neutral';
}

function minutesBetween(start, end) {
  const delta = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(delta) ? Math.max(0, Math.round(delta / 60000)) : 0;
}

export function recordConversationSlaEvent(state, conversation, reason = 'evaluated') {
  ensureInbox(state.db);
  const ageMinutes = minutesBetween(conversation.createdAt, nowIso());
  const targetMinutes = priorityMinutes(conversation.priority);
  const event = {
    id: createId('csla'),
    workspaceId: conversation.workspaceId,
    conversationId: conversation.id,
    reason,
    status: conversation.status,
    priority: conversation.priority,
    targetMinutes,
    ageMinutes,
    state: conversation.status === 'closed' ? 'resolved' : ageMinutes > targetMinutes ? 'breached' : conversation.priority === 'urgent' || ageMinutes > targetMinutes * 0.8 ? 'at_risk' : 'healthy',
    evaluatedAt: nowIso()
  };
  conversation.slaState = event.state;
  state.db.conversationSlaEvents.unshift(event);
  state.db.conversationSlaEvents = state.db.conversationSlaEvents.slice(0, 500);
  return event;
}

export function summarizeInbox(state, workspaceId) {
  ensureInbox(state.db);
  const conversations = state.db.conversations.filter((entry) => entry.workspaceId === workspaceId);
  const slaEvents = state.db.conversationSlaEvents.filter((entry) => entry.workspaceId === workspaceId);
  const assignments = state.db.conversationAssignments.filter((entry) => entry.workspaceId === workspaceId);
  const handoffs = state.db.conversationAutomationHandoffs.filter((entry) => entry.workspaceId === workspaceId);
  return {
    total: conversations.length,
    open: conversations.filter((entry) => entry.status === 'open').length,
    waiting: conversations.filter((entry) => entry.status === 'waiting_on_customer').length,
    closed: conversations.filter((entry) => entry.status === 'closed').length,
    channels: [...new Set(conversations.map((entry) => entry.channel))].sort(),
    sla: {
      healthy: conversations.filter((entry) => ['healthy', 'resolved'].includes(entry.slaState)).length,
      atRisk: conversations.filter((entry) => entry.slaState === 'at_risk').length,
      breached: conversations.filter((entry) => entry.slaState === 'breached' || entry.slaState === 'breached_soon').length,
      events: slaEvents.length
    },
    assignmentEvents: assignments.length,
    automationHandoffs: handoffs.length
  };
}

export function createConversation(state, actor, body = {}) {
  ensureInbox(state.db);
  const conversation = {
    id: createId('conv'),
    workspaceId: actor.workspace.id,
    createdBy: actor.user.id,
    contactEmail: body.contactEmail || '',
    contactName: body.contactName || '',
    channel: body.channel || 'email',
    subject: body.subject || 'Untitled conversation',
    assignee: body.assignee || actor.user.name,
    priority: body.priority || 'normal',
    status: 'open',
    tags: cleanList(body.tags),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastMessagePreview: body.message || 'Conversation created',
    slaState: body.priority === 'urgent' ? 'at_risk' : 'healthy',
    sentiment: sentimentFor(body.message || body.subject || '')
  };

  const message = {
    id: createId('msg'),
    conversationId: conversation.id,
    workspaceId: actor.workspace.id,
    author: actor.user.name,
    type: 'inbound',
    body: body.message || 'Conversation created from inbox form.',
    createdAt: nowIso()
  };

  state.db.conversations.unshift(conversation);
  state.db.conversationMessages.unshift(message);
  state.db.conversationAssignments.unshift({ id: createId('cassign'), workspaceId: actor.workspace.id, conversationId: conversation.id, from: '', to: conversation.assignee, reason: 'conversation_created', changedBy: actor.user.id, changedAt: nowIso() });
  recordConversationSlaEvent(state, conversation, 'conversation_created');
  return conversation;
}

export function conversationMessages(state, conversationId) {
  ensureInbox(state.db);
  return state.db.conversationMessages
    .filter((entry) => entry.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function replyToConversation(state, actor, conversation, body = {}) {
  ensureInbox(state.db);
  const reply = {
    id: createId('msg'),
    conversationId: conversation.id,
    workspaceId: actor.workspace.id,
    author: actor.user.name,
    type: body.type || 'agent_reply',
    body: body.body || 'Sent a follow-up reply.',
    createdAt: nowIso()
  };
  state.db.conversationMessages.push(reply);
  conversation.updatedAt = nowIso();
  conversation.status = body.status || 'waiting_on_customer';
  conversation.lastMessagePreview = reply.body;
  conversation.assignee = body.assignee || conversation.assignee;
  conversation.sentiment = sentimentFor(reply.body);
  recordConversationSlaEvent(state, conversation, 'reply_sent');
  return reply;
}

export function updateConversationStatus(state, conversation, nextStatus = 'open') {
  ensureInbox(state.db);
  conversation.status = ['open', 'waiting_on_customer', 'closed'].includes(nextStatus) ? nextStatus : 'open';
  conversation.updatedAt = nowIso();
  conversation.slaState = conversation.status === 'closed' ? 'resolved' : conversation.priority === 'urgent' ? 'breached_soon' : 'healthy';
  recordConversationSlaEvent(state, conversation, `status_${conversation.status}`);
  return conversation;
}

export function assignConversation(state, actor, conversation, body = {}) {
  ensureInbox(state.db);
  const previous = conversation.assignee || '';
  const next = body.assignee || actor.user.name;
  conversation.assignee = next;
  conversation.priority = body.priority || conversation.priority;
  conversation.updatedAt = nowIso();
  const event = { id: createId('cassign'), workspaceId: conversation.workspaceId, conversationId: conversation.id, from: previous, to: next, reason: body.reason || 'manual_assignment', changedBy: actor.user.id, changedAt: nowIso() };
  state.db.conversationAssignments.unshift(event);
  state.db.conversationAssignments = state.db.conversationAssignments.slice(0, 500);
  recordConversationSlaEvent(state, conversation, 'assignment_changed');
  return event;
}

export function applyConversationMacro(state, actor, conversation, body = {}) {
  ensureInbox(state.db);
  const macro = {
    id: createId('cmacro'),
    workspaceId: conversation.workspaceId,
    conversationId: conversation.id,
    name: body.name || 'Helpful response',
    category: body.category || 'support',
    body: body.body || 'Thanks for reaching out — we are checking this and will follow up shortly.',
    appliedBy: actor.user.id,
    appliedAt: nowIso()
  };
  state.db.conversationMacros.unshift(macro);
  state.db.conversationMacros = state.db.conversationMacros.slice(0, 500);
  const reply = replyToConversation(state, actor, conversation, { body: macro.body, status: body.status || 'waiting_on_customer', type: 'macro_reply' });
  return { macro, reply };
}

export function createConversationAutomationHandoff(state, actor, conversation, body = {}) {
  ensureInbox(state.db);
  const handoff = {
    id: createId('chandoff'),
    workspaceId: conversation.workspaceId,
    conversationId: conversation.id,
    automationId: body.automationId || '',
    trigger: body.trigger || 'conversation_status_changed',
    payload: {
      contactEmail: conversation.contactEmail,
      subject: conversation.subject,
      status: conversation.status,
      priority: conversation.priority,
      tags: conversation.tags || [],
      sentiment: conversation.sentiment || 'neutral'
    },
    status: 'queued',
    createdBy: actor.user.id,
    createdAt: nowIso()
  };
  state.db.conversationAutomationHandoffs.unshift(handoff);
  state.db.conversationAutomationHandoffs = state.db.conversationAutomationHandoffs.slice(0, 500);
  conversation.updatedAt = nowIso();
  recordConversationSlaEvent(state, conversation, 'automation_handoff_created');
  return handoff;
}

export function buildConversationRuntimeSnapshot(state, workspaceId) {
  ensureInbox(state.db);
  const conversations = state.db.conversations.filter((entry) => entry.workspaceId === workspaceId);
  for (const conversation of conversations) recordConversationSlaEvent(state, conversation, 'runtime_snapshot');
  const messages = state.db.conversationMessages.filter((entry) => entry.workspaceId === workspaceId);
  const slaEvents = state.db.conversationSlaEvents.filter((entry) => entry.workspaceId === workspaceId);
  const assignments = state.db.conversationAssignments.filter((entry) => entry.workspaceId === workspaceId);
  const macros = state.db.conversationMacros.filter((entry) => entry.workspaceId === workspaceId);
  const handoffs = state.db.conversationAutomationHandoffs.filter((entry) => entry.workspaceId === workspaceId);
  return {
    ...CONVERSATION_INBOX_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    summary: summarizeInbox(state, workspaceId),
    threadCount: conversations.length,
    messageCount: messages.length,
    slaEventCount: slaEvents.length,
    assignmentEventCount: assignments.length,
    macroEventCount: macros.length,
    automationHandoffCount: handoffs.length,
    threads: conversations.slice(0, 10).map((conversation) => ({ id: conversation.id, subject: conversation.subject, channel: conversation.channel, status: conversation.status, priority: conversation.priority, assignee: conversation.assignee, slaState: conversation.slaState, sentiment: conversation.sentiment || 'neutral' })),
    recentSlaEvents: slaEvents.slice(0, 10),
    recentAssignments: assignments.slice(0, 10),
    recentMacros: macros.slice(0, 10),
    recentAutomationHandoffs: handoffs.slice(0, 10)
  };
}

export function persistConversationRuntimeSnapshot(state, actor, reason = 'manual_conversation_runtime_snapshot') {
  ensureInbox(state.db);
  const snapshot = buildConversationRuntimeSnapshot(state, actor.workspace.id);
  const entry = { id: createId('crsnap'), reason, recordedAt: nowIso(), userId: actor.user.id, ...snapshot };
  state.db.conversationRuntimeSnapshots.unshift(entry);
  state.db.conversationRuntimeSnapshots = state.db.conversationRuntimeSnapshots.slice(0, 100);
  return entry;
}
