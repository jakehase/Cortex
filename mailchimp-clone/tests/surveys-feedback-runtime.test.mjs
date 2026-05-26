import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';
import {
  SURVEY_FEEDBACK_RUNTIME_CONTRACT,
  buildSurveyFeedbackRuntimeSnapshot,
  createSurveyAutomationHandoff,
  createSurveyProgram,
  persistSurveyFeedbackRuntimeSnapshot,
  recordSurveyDeliveryEvent,
  submitSurveyResponse
} from '../packages/surveys-feedback/index.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('survey feedback runtime builds sentiment, segment, delivery, handoff, and snapshot evidence', () => {
  const state = {
    db: {
      surveyPrograms: [],
      surveyResponses: [],
      surveyRuntimeSnapshots: [],
      surveySentimentEvents: [],
      surveySegments: [],
      surveyDeliveryEvents: [],
      surveyAutomationHandoffs: []
    }
  };
  const actor = { workspace: { id: 'ws_1' }, user: { id: 'user_1' } };
  assert.equal(SURVEY_FEEDBACK_RUNTIME_CONTRACT.surfaceId, 'survey_feedback_insights_runtime_layer');
  const program = createSurveyProgram(state, actor, { name: 'Post-purchase NPS', kind: 'nps', deliveryChannel: 'email' });
  recordSurveyDeliveryEvent(state, actor, program, { recipients: 100, delivered: 95, opened: 40, responded: 0 });
  submitSurveyResponse(state, actor, program, { email: 'fan@example.com', score: '10', comment: 'Great onboarding and easy setup.' });
  submitSurveyResponse(state, actor, program, { email: 'critic@example.com', score: '4', comment: 'Setup took too long and support was slow.' });
  createSurveyAutomationHandoff(state, actor, program, { automationId: 'auto_1', segment: 'detractor', trigger: 'detractor_recovery' });
  const snapshot = persistSurveyFeedbackRuntimeSnapshot(state, actor, 'test_snapshot');
  assert.equal(snapshot.responseCount, 2);
  assert.equal(snapshot.sentimentEventCount, 2);
  assert.equal(snapshot.deliveryEventCount, 2);
  assert.equal(snapshot.automationHandoffCount, 1);
  assert.equal(snapshot.segments.find((entry) => entry.segment === 'promoter').size, 1);
  assert.equal(snapshot.segments.find((entry) => entry.segment === 'detractor').size, 1);
  assert.ok(snapshot.evidenceContract.includes('automation_handoff_payloads'));
});

test('survey feedback runtime routes persist delivery, sentiment, handoff, snapshot, and API evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    await followRedirect(baseUrl, jar, await postForm(baseUrl, jar, '/signup', {
      name: 'Survey Runtime Admin',
      email: 'survey-runtime@example.com',
      password: 'secret123',
      workspaceName: 'Survey Runtime Lab'
    }));

    await postForm(baseUrl, jar, '/surveys', {
      name: 'Post-purchase NPS',
      kind: 'nps',
      deliveryChannel: 'email',
      question: 'How likely are you to recommend us?'
    });
    const survey = server.state.db.surveyPrograms[0];
    assert.equal(server.state.db.surveyDeliveryEvents.length, 1);

    await postForm(baseUrl, jar, `/surveys/${survey.id}/responses`, { email: 'fan@example.com', score: '10', comment: 'Great onboarding.' });
    await postForm(baseUrl, jar, `/surveys/${survey.id}/responses`, { email: 'critic@example.com', score: '4', comment: 'Setup took too long.' });
    await postForm(baseUrl, jar, `/surveys/${survey.id}/delivery`, { recipients: '100', delivered: '96', opened: '44', responded: '2' });
    await postForm(baseUrl, jar, `/surveys/${survey.id}/handoff`, { automationId: 'auto_detractor', segment: 'detractor', trigger: 'detractor_followup' });
    await postForm(baseUrl, jar, '/surveys/runtime/snapshot', {});

    assert.equal(server.state.db.surveyResponses.length, 2);
    assert.equal(server.state.db.surveySentimentEvents.length, 2);
    assert.equal(server.state.db.surveyDeliveryEvents.length, 2);
    assert.equal(server.state.db.surveyAutomationHandoffs.length, 1);
    assert.equal(server.state.db.surveyRuntimeSnapshots.length, 1);

    const api = await request(baseUrl, jar, '/api/surveys/runtime');
    const payload = await api.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.surveyRuntime.surfaceId, 'survey_feedback_insights_runtime_layer');
    assert.equal(payload.surveyRuntime.responseCount, 2);
    assert.equal(payload.surveyRuntime.sentimentEventCount, 2);
    assert.equal(payload.surveyRuntime.automationHandoffCount, 1);
    assert.equal(payload.surveyRuntime.segments.find((entry) => entry.segment === 'detractor').size, 1);

    const overview = await (await request(baseUrl, jar, '/surveys')).text();
    assert.match(overview, /Open survey runtime API/);
    assert.match(overview, /sentiment events: 2/i);
    assert.match(overview, /automation handoffs: 1/i);

    const detail = await (await request(baseUrl, jar, `/surveys/${survey.id}`)).text();
    assert.match(detail, /Runtime handoff/);
    assert.match(detail, /Great onboarding/);
    assert.match(detail, /Setup took too long/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
