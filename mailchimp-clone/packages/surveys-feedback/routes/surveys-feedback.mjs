import { page, readBody, redirect, text, json, escapeHtml, saveDb, recordAudit } from '../../app/index.mjs';
import { buildSurveyFeedbackRuntimeSnapshot, createSurveyAutomationHandoff, createSurveyProgram, persistSurveyFeedbackRuntimeSnapshot, recordSurveyDeliveryEvent, submitSurveyResponse, surveyStats } from '../domain-surveys-feedback.mjs';

export function registerSurveyFeedbackRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/surveys', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    state.db.surveyPrograms ||= [];
    const programs = state.db.surveyPrograms.filter((entry) => entry.workspaceId === actor.workspace.id);
    const runtime = buildSurveyFeedbackRuntimeSnapshot(state, actor.workspace.id);
    text(res, 200, page('Surveys & feedback', actor, `<div class="grid"><div class="card"><h3>Create survey program</h3><form method="post" action="/surveys"><input name="name" placeholder="Post-purchase NPS" required><select name="kind"><option value="nps">nps</option><option value="csat">csat</option></select><select name="deliveryChannel"><option value="email">email</option><option value="sms">sms</option></select><input name="question" placeholder="How likely are you to recommend us?"><button>Create survey</button></form></div><div class="card"><h3>Feedback runtime</h3><p>Programs: ${runtime.programCount} · responses: ${runtime.responseCount} · sentiment events: ${runtime.sentimentEventCount}</p><p>Delivery events: ${runtime.deliveryEventCount} · automation handoffs: ${runtime.automationHandoffCount}</p><p>Segments: ${runtime.segments.map((segment) => `${segment.segment}:${segment.size}`).join(', ')}</p><form method="post" action="/surveys/runtime/snapshot"><button>Capture survey runtime snapshot</button></form><p><a href="/api/surveys/runtime">Open survey runtime API</a></p></div><div class="card"><h3>Programs</h3><table><tr><th>Name</th><th>Kind</th><th>Responses</th></tr>${programs.map((program) => `<tr><td><a href="/surveys/${program.id}">${escapeHtml(program.name)}</a></td><td>${escapeHtml(program.kind)}</td><td>${surveyStats(state, program.id).responses}</td></tr>`).join('') || '<tr><td colspan="3">No survey programs yet.</td></tr>'}</table></div></div>`));
  });

  router.register('POST', '/surveys', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const program = createSurveyProgram(state, actor, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'survey-program-create', detail: `Created survey ${program.name}` });
    redirect(res, `/surveys/${program.id}`);
  });

  router.register('GET', '/surveys/:id', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const program = (state.db.surveyPrograms || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!program) return text(res, 404, page('Surveys & feedback', actor, '<div class="warn">Survey program not found.</div>'));
    const stats = surveyStats(state, program.id);
    text(res, 200, page('Survey program detail', actor, `<div class="grid"><div class="card"><h3>${escapeHtml(program.name)}</h3><p>${escapeHtml(program.kind)} via ${escapeHtml(program.deliveryChannel)}</p><p>${stats.responses} responses · average ${stats.averageScore}</p><p>${stats.promoters} promoters · ${stats.passives} passives · ${stats.detractors} detractors</p></div><div class="card"><h3>Add response</h3><form method="post" action="/surveys/${program.id}/responses"><input type="email" name="email" placeholder="person@example.com" required><input type="number" min="0" max="10" name="score" placeholder="9" required><textarea name="comment" placeholder="Loved the onboarding."></textarea><button>Record response</button></form></div><div class="card"><h3>Runtime handoff</h3><form method="post" action="/surveys/${program.id}/delivery"><input name="recipients" value="100"><input name="delivered" value="96"><input name="opened" value="44"><input name="responded" value="${stats.responses}"><button>Record delivery</button></form><form method="post" action="/surveys/${program.id}/handoff"><input name="automationId" placeholder="automation id"><select name="segment"><option value="detractor">detractor</option><option value="promoter">promoter</option><option value="passive">passive</option></select><input name="trigger" value="survey_segment_changed"><button>Queue automation handoff</button></form></div></div><div class="card"><h3>Recent comments</h3>${stats.latestComments.map((comment) => `<div style="padding:10px 0;border-bottom:1px solid #dde5f1">${escapeHtml(comment)}</div>`).join('') || '<p>No comments yet.</p>'}</div>`));
  });

  router.register('POST', '/surveys/:id/responses', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const program = (state.db.surveyPrograms || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!program) return text(res, 404, page('Surveys & feedback', actor, '<div class="warn">Survey program not found.</div>'));
    const response = submitSurveyResponse(state, actor, program, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'survey-response-record', detail: `Recorded ${response.score} for ${program.name}` });
    redirect(res, `/surveys/${program.id}`);
  });

  router.register('POST', '/surveys/:id/delivery', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const program = (state.db.surveyPrograms || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!program) return text(res, 404, page('Surveys & feedback', actor, '<div class="warn">Survey program not found.</div>'));
    const event = recordSurveyDeliveryEvent(state, actor, program, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'survey-delivery-record', detail: `Recorded survey delivery ${event.id} for ${program.name}` });
    redirect(res, `/surveys/${program.id}`);
  });

  router.register('POST', '/surveys/:id/handoff', async ({ state, req, res, params }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const program = (state.db.surveyPrograms || []).find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (!program) return text(res, 404, page('Surveys & feedback', actor, '<div class="warn">Survey program not found.</div>'));
    const handoff = createSurveyAutomationHandoff(state, actor, program, await readBody(req));
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'survey-automation-handoff', detail: `Queued ${handoff.trigger} for ${program.name}` });
    redirect(res, `/surveys/${program.id}`);
  });

  router.register('POST', '/surveys/runtime/snapshot', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    persistSurveyFeedbackRuntimeSnapshot(state, actor, 'manual_route_snapshot');
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'survey-runtime-snapshot', detail: 'Captured survey feedback runtime snapshot' });
    redirect(res, '/surveys');
  });

  router.register('GET', '/api/surveys/runtime', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    json(res, 200, { ok: true, surveyRuntime: buildSurveyFeedbackRuntimeSnapshot(state, actor.workspace.id) });
  });
}
