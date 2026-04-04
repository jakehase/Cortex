import { page, requireAdmin } from '../view.mjs';
import { readBody, redirect, text } from '../utils.mjs';
import { addApprovalComment, approvalSummary, approvalTargets, createApprovalRequest, decideApprovalRequest } from '../domain-collaboration-approval.mjs';

export function registerCollaborationApprovalRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/approvals', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const summary = approvalSummary(state, actor.workspace.id);
    const targets = approvalTargets(state, actor.workspace.id);
    const requests = state.db.approvalRequests.filter((entry) => entry.workspaceId === actor.workspace.id);
    const comments = state.db.approvalComments.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Collaboration approvals', actor, `<div class="grid"><div class="card"><h3>Request approval</h3><form method="post" action="/approvals/request"><select name="targetId">${targets.map((target) => `<option value="${target.id}" data-type="${target.type}">${target.type}: ${target.name}</option>`).join('')}</select><select name="targetType">${['campaign', 'automation', 'template'].map((type) => `<option value="${type}">${type}</option>`).join('')}</select><input name="title" placeholder="Executive approval"><textarea name="note" placeholder="Share context, compliance notes, or blockers"></textarea><input name="approversRequired" value="1"><button>Send approval request</button></form></div><div class="card"><h3>Approval summary</h3><ul><li>Total requests: ${summary.total}</li><li>Pending: ${summary.pending}</li><li>Approved: ${summary.approved}</li><li>Changes requested: ${summary.changesRequested}</li><li>Comments: ${summary.commentCount}</li></ul></div></div><div class="card"><h3>Approval queue</h3><table><tr><th>Target</th><th>Status</th><th>Approvers</th><th>Actions</th></tr>${requests.map((request) => `<tr><td>${request.title}</td><td>${request.status}</td><td>${request.approversRequired}</td><td><form method="post" action="/approvals/${request.id}/comment"><input name="comment" placeholder="Feedback for the owner"><button>Add comment</button></form><form method="post" action="/approvals/${request.id}/approve"><button>Approve</button></form><form method="post" action="/approvals/${request.id}/reject"><button>Request changes</button></form></td></tr>`).join('') || '<tr><td colspan="4">No approval requests yet.</td></tr>'}</table></div><div class="card"><h3>Discussion</h3><table><tr><th>Author</th><th>Comment</th><th>When</th></tr>${comments.map((comment) => `<tr><td>${comment.authorName}</td><td>${comment.body}</td><td>${comment.createdAt}</td></tr>`).join('') || '<tr><td colspan="3">No approval comments yet.</td></tr>'}</table></div>`));
  });

  router.register('POST', '/approvals/request', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    createApprovalRequest(state, actor, await readBody(req));
    redirect(res, '/approvals');
  });

  router.register('POST', '/approvals/:id/comment', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const request = state.db.approvalRequests.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
    if (request) addApprovalComment(state, actor, request, await readBody(req));
    redirect(res, '/approvals');
  });

  for (const [action, decision] of [['approve', 'approve'], ['reject', 'reject']]) {
    router.register('POST', `/approvals/:id/${action}`, async ({ state, req, params, res }) => {
      const actor = requireAuth(state, req, res);
      if (!actor || !requireAdmin(actor, res, text)) return;
      const request = state.db.approvalRequests.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id);
      if (request) decideApprovalRequest(state, actor, request, decision);
      redirect(res, '/approvals');
    });
  }
}
