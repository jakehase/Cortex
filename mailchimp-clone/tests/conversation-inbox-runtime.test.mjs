import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';
import {
  CONVERSATION_INBOX_RUNTIME_CONTRACT,
  assignConversation,
  applyConversationMacro,
  buildConversationRuntimeSnapshot,
  createConversation,
  createConversationAutomationHandoff,
  persistConversationRuntimeSnapshot
} from '../packages/conversation-inbox/index.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('conversation inbox runtime builds SLA, assignment, macro, handoff, and snapshot evidence', () => {
  const state = {
    db: {
      conversations: [],
      conversationMessages: [],
      conversationRuntimeSnapshots: [],
      conversationSlaEvents: [],
      conversationAssignments: [],
      conversationMacros: [],
      conversationAutomationHandoffs: []
    }
  };
  const actor = { workspace: { id: 'ws_1' }, user: { id: 'user_1', name: 'Ada Admin' } };
  assert.equal(CONVERSATION_INBOX_RUNTIME_CONTRACT.surfaceId, 'conversation_inbox_sla_assignment_runtime_layer');
  const conversation = createConversation(state, actor, {
    contactName: 'Riley Buyer',
    contactEmail: 'riley@example.com',
    channel: 'chat',
    subject: 'Cancel and refund request',
    priority: 'urgent',
    tags: 'vip,renewal',
    message: 'I am frustrated and need a refund.'
  });
  assert.equal(conversation.sentiment, 'negative');
  assignConversation(state, actor, conversation, { assignee: 'Support Lead', priority: 'high', reason: 'vip_escalation' });
  applyConversationMacro(state, actor, conversation, { name: 'Refund next steps', body: 'Thanks — we can help with the refund next steps.', status: 'waiting_on_customer' });
  createConversationAutomationHandoff(state, actor, conversation, { automationId: 'auto_1', trigger: 'vip_refund_followup' });
  const snapshot = persistConversationRuntimeSnapshot(state, actor, 'test_snapshot');
  assert.equal(snapshot.threadCount, 1);
  assert.equal(snapshot.assignmentEventCount, 2);
  assert.equal(snapshot.macroEventCount, 1);
  assert.equal(snapshot.automationHandoffCount, 1);
  assert.equal(snapshot.summary.automationHandoffs, 1);
  assert.ok(snapshot.evidenceContract.includes('macro_replies_persisted_to_timeline'));
});

test('conversation inbox runtime routes expose assignment, macro, handoff, snapshot, and API evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Conversation Runtime Admin',
      email: 'conversation-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Conversation Runtime Lab'
    }));

    await postForm(baseUrl, jar, '/conversations', {
      contactName: 'Riley Buyer',
      contactEmail: 'riley@example.com',
      channel: 'chat',
      subject: 'Renewal question',
      priority: 'urgent',
      tags: 'vip,renewal',
      message: 'Need help with renewal timing and I am frustrated.'
    });
    const conversation = server.state.db.conversations[0];
    assert.equal(conversation.slaState, 'at_risk');
    assert.equal(conversation.sentiment, 'negative');

    let detail = await (await request(baseUrl, jar, `/conversations/${conversation.id}`)).text();
    assert.match(detail, /Assignment and handoff/);
    assert.match(detail, /Reply macro/);

    await postForm(baseUrl, jar, `/conversations/${conversation.id}/assign`, { assignee: 'Support Lead', priority: 'high', reason: 'vip_escalation' });
    await postForm(baseUrl, jar, `/conversations/${conversation.id}/macro`, { name: 'Renewal helper', category: 'support', body: 'Thanks — here is the next best renewal step.', status: 'waiting_on_customer' });
    await postForm(baseUrl, jar, `/conversations/${conversation.id}/handoff`, { automationId: 'auto_renewal', trigger: 'renewal_followup' });
    await postForm(baseUrl, jar, '/conversations/runtime/snapshot', {});

    assert.equal(server.state.db.conversationAssignments.length >= 2, true);
    assert.equal(server.state.db.conversationMacros.length, 1);
    assert.equal(server.state.db.conversationAutomationHandoffs.length, 1);
    assert.equal(server.state.db.conversationRuntimeSnapshots.length, 1);
    assert.equal(server.state.db.conversationMessages.some((entry) => entry.type === 'macro_reply'), true);

    const api = await request(baseUrl, jar, '/api/conversations/runtime');
    const payload = await api.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.conversationRuntime.surfaceId, 'conversation_inbox_sla_assignment_runtime_layer');
    assert.equal(payload.conversationRuntime.threadCount, 1);
    assert.equal(payload.conversationRuntime.assignmentEventCount >= 2, true);
    assert.equal(payload.conversationRuntime.macroEventCount, 1);
    assert.equal(payload.conversationRuntime.automationHandoffCount, 1);

    const overview = await (await request(baseUrl, jar, '/conversations')).text();
    assert.match(overview, /Open conversation runtime API/);
    assert.match(overview, /automation handoffs: 1/i);
    detail = await (await request(baseUrl, jar, `/conversations/${conversation.id}`)).text();
    assert.match(detail, /Support Lead/);
    assert.match(detail, /Thanks — here is the next best renewal step/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
