import { createId, nowIso } from '../app/index.mjs';

function ensureInbox(db) {
  db.conversations ||= [];
  db.conversationMessages ||= [];
}

function cleanList(value = '') {
  return String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
}

export function summarizeInbox(state, workspaceId) {
  ensureInbox(state.db);
  const conversations = state.db.conversations.filter((entry) => entry.workspaceId === workspaceId);
  return {
    total: conversations.length,
    open: conversations.filter((entry) => entry.status === 'open').length,
    waiting: conversations.filter((entry) => entry.status === 'waiting_on_customer').length,
    closed: conversations.filter((entry) => entry.status === 'closed').length,
    channels: [...new Set(conversations.map((entry) => entry.channel))].sort()
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
    slaState: body.priority === 'urgent' ? 'breached_soon' : 'healthy'
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
  return reply;
}

export function updateConversationStatus(conversation, nextStatus = 'open') {
  conversation.status = ['open', 'waiting_on_customer', 'closed'].includes(nextStatus) ? nextStatus : 'open';
  conversation.updatedAt = nowIso();
  conversation.slaState = conversation.status === 'closed' ? 'resolved' : conversation.priority === 'urgent' ? 'breached_soon' : 'healthy';
  return conversation;
}
