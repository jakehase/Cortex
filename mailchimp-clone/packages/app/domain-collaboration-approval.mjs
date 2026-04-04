import { saveDb } from './storage.mjs';
import { createId, nowIso } from './utils.mjs';
import { createNotification, recordAudit, recordEvent } from './domain-core.mjs';

function findTarget(state, workspaceId, targetType, targetId) {
  if (targetType === 'campaign') return state.db.campaigns.find((entry) => entry.workspaceId === workspaceId && entry.id === targetId) || null;
  if (targetType === 'automation') return state.db.automations.find((entry) => entry.workspaceId === workspaceId && entry.id === targetId) || null;
  if (targetType === 'template') return state.db.contentTemplates.find((entry) => entry.workspaceId === workspaceId && entry.id === targetId) || null;
  return null;
}

function targetLabel(targetType) {
  return targetType === 'automation' ? 'automation' : targetType === 'template' ? 'content template' : 'campaign';
}

export function approvalTargets(state, workspaceId) {
  return [
    ...state.db.campaigns.filter((entry) => entry.workspaceId === workspaceId).map((entry) => ({ id: entry.id, type: 'campaign', name: entry.name })),
    ...state.db.automations.filter((entry) => entry.workspaceId === workspaceId).map((entry) => ({ id: entry.id, type: 'automation', name: entry.name })),
    ...state.db.contentTemplates.filter((entry) => entry.workspaceId === workspaceId).map((entry) => ({ id: entry.id, type: 'template', name: entry.name }))
  ];
}

export function approvalSummary(state, workspaceId) {
  const requests = state.db.approvalRequests.filter((entry) => entry.workspaceId === workspaceId);
  return {
    total: requests.length,
    pending: requests.filter((entry) => entry.status === 'pending').length,
    approved: requests.filter((entry) => entry.status === 'approved').length,
    changesRequested: requests.filter((entry) => entry.status === 'changes_requested').length,
    commentCount: state.db.approvalComments.filter((entry) => entry.workspaceId === workspaceId).length
  };
}

export function createApprovalRequest(state, actor, body) {
  const targetType = body.targetType || 'campaign';
  const targetId = body.targetId;
  const target = findTarget(state, actor.workspace.id, targetType, targetId);
  if (!target) throw new Error('Approval target not found');

  const request = {
    id: createId('approval'),
    workspaceId: actor.workspace.id,
    targetType,
    targetId,
    title: body.title || `${target.name} review`,
    note: body.note || '',
    status: 'pending',
    approversRequired: Math.max(1, Number(body.approversRequired || 1)),
    requestedBy: actor.user.id,
    requestedAt: nowIso(),
    decidedAt: null,
    dueDate: body.dueDate || null
  };
  state.db.approvalRequests.unshift(request);
  target.approvalStatus = 'pending';
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'approval-request-create', detail: `Requested approval for ${targetLabel(targetType)} ${target.name}` });
  createNotification(state, { workspaceId: actor.workspace.id, type: 'approval-requested', payload: { requestId: request.id, targetType, targetId } });
  return request;
}

export function addApprovalComment(state, actor, request, body) {
  const comment = {
    id: createId('acomment'),
    workspaceId: actor.workspace.id,
    approvalRequestId: request.id,
    authorId: actor.user.id,
    authorName: actor.user.name,
    body: body.comment || '',
    createdAt: nowIso()
  };
  state.db.approvalComments.unshift(comment);
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'approval-comment', detail: `Commented on approval ${request.id}` });
  return comment;
}

export function decideApprovalRequest(state, actor, request, decision) {
  request.status = decision === 'approve' ? 'approved' : 'changes_requested';
  request.decidedAt = nowIso();
  const target = findTarget(state, actor.workspace.id, request.targetType, request.targetId);
  if (target) target.approvalStatus = request.status;
  saveDb(state.db);
  recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: `approval-${request.status}`, detail: `${request.status} ${request.id}` });
  recordEvent(state, { workspaceId: actor.workspace.id, type: 'approval-decision', message: `${request.status} ${request.id}`, meta: { requestId: request.id, decisionBy: actor.user.id } });
  return request;
}
