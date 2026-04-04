import {
  page,
  readBody,
  redirect,
  text,
  escapeHtml,
  saveDb,
  recordAudit
} from '../../app/index.mjs';
import {
  summarizeInbox,
  createConversation,
  conversationMessages,
  replyToConversation,
  updateConversationStatus
} from '../domain-conversation-inbox.mjs';

function inboxTable(conversations = []) {
  return `<table><tr><th>Subject</th><th>Channel</th><th>Status</th><th>Priority</th><th>Assignee</th></tr>${conversations.map((conversation) => `<tr><td><a href="/conversations/${conversation.id}">${escapeHtml(conversation.subject)}</a><div class="muted">${escapeHtml(conversation.contactEmail)}</div></td><td>${escapeHtml(conversation.channel)}</td><td>${escapeHtml(conversation.status)}</td><td>${escapeHtml(conversation.priority)}</td><td>${escapeHtml(conversation.assignee)}</td></tr>`).join('')}</table>`;
}

export function registerConversationInboxRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/conversations', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    state.db.conversations ||= [];
    const summary = summarizeInbox(state, actor.workspace.id);
    const conversations = state.db.conversations.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Conversations inbox', actor, `<div class="grid"><div class="card"><h3>Inbox summary</h3><p>${summary.total} total · ${summary.open} open · ${summary.waiting} waiting · ${summary.closed} closed</p><p>Channels: ${summary.channels.join(', ') || 'none yet'}</p></div><div class="card"><h3>New conversation</h3><form method="post" action="/conversations"><input name="contactName" placeholder="Customer name"><input name="contactEmail" type="email" placeholder="customer@example.com" required><select name="channel"><option value="email">email</option><option value="sms">sms</option><option value="chat">chat</option></select><input name="subject" placeholder="Subject" required><select name="priority"><option value="normal">normal</option><option value="urgent">urgent</option></select><input name="assignee" placeholder="Assignee"><input name="tags" placeholder="vip, renewal"><textarea name="message" placeholder="Initial message"></textarea><button>Create conversation</button></form></div></div><div class="card"><h3>Open threads</h3>${inboxTable(conversations)}</div>`));
  });

  router.register('POST', '/conversations', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const conversation = createConversation(state, actor, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'conversation-create', detail: `Created inbox thread ${conversation.subject}` });
    redirect(res, `/conversations/${conversation.id}`);
  });

  router.register('GET', '/conversations/:id', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const conversation = (state.db.conversations || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!conversation) return text(res, 404, page('Conversations inbox', actor, '<div class="warn">Conversation not found.</div>'));
    const messages = conversationMessages(state, conversation.id);
    text(res, 200, page('Conversation thread', actor, `<div class="grid"><div class="card"><h3>${escapeHtml(conversation.subject)}</h3><p>${escapeHtml(conversation.contactName || conversation.contactEmail)}</p><p>Status: <strong>${escapeHtml(conversation.status)}</strong> · Priority: ${escapeHtml(conversation.priority)} · SLA: ${escapeHtml(conversation.slaState)}</p><form method="post" action="/conversations/${conversation.id}/status"><select name="status"><option value="open">open</option><option value="waiting_on_customer">waiting_on_customer</option><option value="closed">closed</option></select><button>Update status</button></form></div><div class="card"><h3>Reply</h3><form method="post" action="/conversations/${conversation.id}/reply"><textarea name="body" placeholder="Reply"></textarea><select name="status"><option value="waiting_on_customer">waiting_on_customer</option><option value="open">open</option><option value="closed">closed</option></select><button>Send reply</button></form></div></div><div class="card"><h3>Timeline</h3>${messages.map((message) => `<div style="padding:10px 0;border-bottom:1px solid #dde5f1"><strong>${escapeHtml(message.author)}</strong> · ${escapeHtml(message.type)}<div>${escapeHtml(message.body)}</div><div class="muted">${escapeHtml(message.createdAt)}</div></div>`).join('')}</div>`));
  });

  router.register('POST', '/conversations/:id/reply', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const conversation = (state.db.conversations || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!conversation) return text(res, 404, page('Conversations inbox', actor, '<div class="warn">Conversation not found.</div>'));
    const reply = replyToConversation(state, actor, conversation, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'conversation-reply', detail: `Replied on ${conversation.subject}: ${reply.body}` });
    redirect(res, `/conversations/${conversation.id}`);
  });

  router.register('POST', '/conversations/:id/status', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const conversation = (state.db.conversations || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!conversation) return text(res, 404, page('Conversations inbox', actor, '<div class="warn">Conversation not found.</div>'));
    const body = await readBody(req);
    updateConversationStatus(conversation, body.status);
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'conversation-status', detail: `Marked ${conversation.subject} as ${conversation.status}` });
    redirect(res, `/conversations/${conversation.id}`);
  });
}
