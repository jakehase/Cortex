import { createId, nowIso } from '../app/index.mjs';

function ensureSurveys(db) {
  db.surveyPrograms ||= [];
  db.surveyResponses ||= [];
}

export function createSurveyProgram(state, actor, body = {}) {
  ensureSurveys(state.db);
  const program = {
    id: createId('survey'),
    workspaceId: actor.workspace.id,
    name: body.name || 'Customer feedback',
    kind: body.kind || 'nps',
    deliveryChannel: body.deliveryChannel || 'email',
    question: body.question || 'How likely are you to recommend us?',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.db.surveyPrograms.unshift(program);
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
  program.updatedAt = response.createdAt;
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
