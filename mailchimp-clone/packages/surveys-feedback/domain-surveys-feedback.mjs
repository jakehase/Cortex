import { createId, nowIso } from '../app/index.mjs';

export const SURVEY_FEEDBACK_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'survey_feedback_insights_runtime_layer',
  label: 'Survey feedback insights, segmentation, delivery, and automation handoff runtime',
  controls: [
    'survey_sentiment_ledger',
    'feedback_segment_builder',
    'survey_delivery_event_ledger',
    'survey_automation_handoff_events',
    'survey_runtime_snapshots',
    'workspace_survey_runtime_api'
  ],
  evidenceContract: [
    'nps_csat_rollup_snapshots',
    'response_sentiment_and_topic_classification',
    'promoter_passive_detractor_segments',
    'delivery_and_response_conversion_events',
    'automation_handoff_payloads',
    'normal_survey_route_adoption'
  ]
});

function ensureSurveys(db) {
  db.surveyPrograms ||= [];
  db.surveyResponses ||= [];
  db.surveyRuntimeSnapshots ||= [];
  db.surveySentimentEvents ||= [];
  db.surveySegments ||= [];
  db.surveyDeliveryEvents ||= [];
  db.surveyAutomationHandoffs ||= [];
}

function classifyResponse(score = 0) {
  const value = Number(score || 0);
  if (value >= 9) return 'promoter';
  if (value <= 6) return 'detractor';
  return 'passive';
}

function sentimentFor(score = 0, comment = '') {
  const text = String(comment || '').toLowerCase();
  if (Number(score) <= 6 || /bad|broken|slow|hard|frustrating|too long|cancel|refund/.test(text)) return 'negative';
  if (Number(score) >= 9 || /great|love|easy|excellent|helpful|fast/.test(text)) return 'positive';
  return 'neutral';
}

function topicsFor(comment = '') {
  const text = String(comment || '').toLowerCase();
  const topics = [];
  if (/onboard|setup|start/.test(text)) topics.push('onboarding');
  if (/price|billing|invoice|cost/.test(text)) topics.push('pricing');
  if (/support|help|reply|service/.test(text)) topics.push('support');
  if (/slow|fast|performance|speed/.test(text)) topics.push('performance');
  return topics.length ? topics : ['general_feedback'];
}

export function recordSurveyDeliveryEvent(state, actor, program, body = {}) {
  ensureSurveys(state.db);
  const event = {
    id: createId('sdel'),
    workspaceId: actor.workspace.id,
    surveyId: program.id,
    channel: body.channel || program.deliveryChannel || 'email',
    audienceId: body.audienceId || program.audienceId || '',
    campaignId: body.campaignId || program.campaignId || '',
    recipients: Number(body.recipients || 0),
    delivered: Number(body.delivered || body.recipients || 0),
    opened: Number(body.opened || 0),
    responded: Number(body.responded || 0),
    status: body.status || 'recorded',
    recordedAt: nowIso()
  };
  state.db.surveyDeliveryEvents.unshift(event);
  state.db.surveyDeliveryEvents = state.db.surveyDeliveryEvents.slice(0, 500);
  program.updatedAt = nowIso();
  return event;
}

export function recordSurveySentimentEvent(state, actor, program, response) {
  ensureSurveys(state.db);
  const event = {
    id: createId('ssent'),
    workspaceId: actor.workspace.id,
    surveyId: program.id,
    responseId: response.id,
    email: response.email,
    score: response.score,
    segment: classifyResponse(response.score),
    sentiment: sentimentFor(response.score, response.comment),
    topics: topicsFor(response.comment),
    commentPreview: String(response.comment || '').slice(0, 160),
    analyzedAt: nowIso()
  };
  state.db.surveySentimentEvents.unshift(event);
  state.db.surveySentimentEvents = state.db.surveySentimentEvents.slice(0, 500);
  return event;
}

export function createSurveyProgram(state, actor, body = {}) {
  ensureSurveys(state.db);
  const program = {
    id: createId('survey'),
    workspaceId: actor.workspace.id,
    name: body.name || 'Customer feedback',
    kind: body.kind || 'nps',
    deliveryChannel: body.deliveryChannel || 'email',
    audienceId: body.audienceId || '',
    campaignId: body.campaignId || '',
    automationId: body.automationId || '',
    question: body.question || 'How likely are you to recommend us?',
    runtime: { deliveryEvents: 0, responseEvents: 0, lastSnapshotAt: null },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.db.surveyPrograms.unshift(program);
  recordSurveyDeliveryEvent(state, actor, program, { channel: program.deliveryChannel, status: 'program_created' });
  return program;
}

export function submitSurveyResponse(state, actor, program, body = {}) {
  ensureSurveys(state.db);
  const response = {
    id: createId('sresp'),
    workspaceId: actor.workspace.id,
    surveyId: program.id,
    email: body.email || '',
    score: Number(body.score || 0),
    comment: body.comment || '',
    createdAt: nowIso()
  };
  state.db.surveyResponses.unshift(response);
  recordSurveySentimentEvent(state, actor, program, response);
  program.updatedAt = response.createdAt;
  program.runtime ||= { deliveryEvents: 0, responseEvents: 0, lastSnapshotAt: null };
  program.runtime.responseEvents = Number(program.runtime.responseEvents || 0) + 1;
  return response;
}

export function surveyStats(state, surveyId) {
  ensureSurveys(state.db);
  const responses = state.db.surveyResponses.filter((entry) => entry.surveyId === surveyId);
  const promoters = responses.filter((entry) => entry.score >= 9).length;
  const detractors = responses.filter((entry) => entry.score <= 6).length;
  const passives = responses.length - promoters - detractors;
  return {
    responses: responses.length,
    promoters,
    passives,
    detractors,
    averageScore: responses.length ? Number((responses.reduce((sum, entry) => sum + entry.score, 0) / responses.length).toFixed(2)) : 0,
    latestComments: responses.slice(0, 3).map((entry) => entry.comment).filter(Boolean)
  };
}

export function buildSurveyFeedbackSegments(state, workspaceId) {
  ensureSurveys(state.db);
  const responses = state.db.surveyResponses.filter((entry) => entry.workspaceId === workspaceId);
  const bySegment = { promoter: [], passive: [], detractor: [] };
  for (const response of responses) bySegment[classifyResponse(response.score)].push(response);
  const segments = Object.entries(bySegment).map(([segment, rows]) => ({
    id: `${workspaceId}_${segment}`,
    workspaceId,
    segment,
    size: rows.length,
    emails: rows.slice(0, 25).map((entry) => entry.email).filter(Boolean),
    averageScore: rows.length ? Number((rows.reduce((sum, entry) => sum + Number(entry.score || 0), 0) / rows.length).toFixed(2)) : 0,
    updatedAt: nowIso()
  }));
  state.db.surveySegments = [...segments, ...state.db.surveySegments.filter((entry) => entry.workspaceId !== workspaceId)].slice(0, 100);
  return segments;
}

export function createSurveyAutomationHandoff(state, actor, program, body = {}) {
  ensureSurveys(state.db);
  const stats = surveyStats(state, program.id);
  const handoff = {
    id: createId('shandoff'),
    workspaceId: actor.workspace.id,
    surveyId: program.id,
    automationId: body.automationId || program.automationId || '',
    trigger: body.trigger || 'survey_feedback_segment_changed',
    segment: body.segment || 'detractor',
    payload: {
      surveyName: program.name,
      kind: program.kind,
      responses: stats.responses,
      promoters: stats.promoters,
      passives: stats.passives,
      detractors: stats.detractors,
      averageScore: stats.averageScore
    },
    status: 'queued',
    createdBy: actor.user.id,
    createdAt: nowIso()
  };
  state.db.surveyAutomationHandoffs.unshift(handoff);
  state.db.surveyAutomationHandoffs = state.db.surveyAutomationHandoffs.slice(0, 500);
  return handoff;
}

export function buildSurveyFeedbackRuntimeSnapshot(state, workspaceId) {
  ensureSurveys(state.db);
  const programs = state.db.surveyPrograms.filter((entry) => entry.workspaceId === workspaceId);
  const responses = state.db.surveyResponses.filter((entry) => entry.workspaceId === workspaceId);
  const sentimentEvents = state.db.surveySentimentEvents.filter((entry) => entry.workspaceId === workspaceId);
  const deliveryEvents = state.db.surveyDeliveryEvents.filter((entry) => entry.workspaceId === workspaceId);
  const handoffs = state.db.surveyAutomationHandoffs.filter((entry) => entry.workspaceId === workspaceId);
  const segments = buildSurveyFeedbackSegments(state, workspaceId);
  return {
    ...SURVEY_FEEDBACK_RUNTIME_CONTRACT,
    generatedAt: nowIso(),
    workspaceId,
    programCount: programs.length,
    responseCount: responses.length,
    sentimentEventCount: sentimentEvents.length,
    deliveryEventCount: deliveryEvents.length,
    automationHandoffCount: handoffs.length,
    segments,
    programs: programs.map((program) => ({ id: program.id, name: program.name, kind: program.kind, deliveryChannel: program.deliveryChannel, stats: surveyStats(state, program.id) })),
    recentSentimentEvents: sentimentEvents.slice(0, 10),
    recentDeliveryEvents: deliveryEvents.slice(0, 10),
    recentAutomationHandoffs: handoffs.slice(0, 10)
  };
}

export function persistSurveyFeedbackRuntimeSnapshot(state, actor, reason = 'manual_survey_runtime_snapshot') {
  ensureSurveys(state.db);
  const snapshot = buildSurveyFeedbackRuntimeSnapshot(state, actor.workspace.id);
  const entry = { id: createId('srun'), reason, recordedAt: nowIso(), userId: actor.user.id, ...snapshot };
  state.db.surveyRuntimeSnapshots.unshift(entry);
  state.db.surveyRuntimeSnapshots = state.db.surveyRuntimeSnapshots.slice(0, 100);
  for (const program of state.db.surveyPrograms.filter((entry) => entry.workspaceId === actor.workspace.id)) {
    program.runtime ||= {};
    program.runtime.lastSnapshotAt = entry.recordedAt;
  }
  return entry;
}
