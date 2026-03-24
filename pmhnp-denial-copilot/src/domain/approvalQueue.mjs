import path from 'node:path';

import { APPROVALS_DIR } from '../config.mjs';
import { listJson, makeId, nowIso, readJson, writeJson } from '../lib/storage.mjs';

function approvalFile(approvalId) {
  return path.join(APPROVALS_DIR, `${approvalId}.json`);
}

function withHistory(record, event, details = {}) {
  record.history = record.history || [];
  record.history.push({ at: nowIso(), event, details });
  record.updated_at = nowIso();
  return record;
}

export function listApprovals({ status, subject_id, session_id } = {}) {
  return listJson(APPROVALS_DIR)
    .filter((item) => !status || item.status === status)
    .filter((item) => !subject_id || item.subject_id === subject_id)
    .filter((item) => !session_id || item.session_id === session_id)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

export function getApproval(approvalId) {
  return readJson(approvalFile(approvalId), null);
}

export function findPendingApprovalBySubject({ type, subject_id, session_id }) {
  return listApprovals({ status: 'pending', subject_id, session_id })
    .find((item) => item.type === type) || null;
}

export function latestApprovalBySubject({ type, subject_id, session_id }) {
  return listApprovals({ subject_id, session_id })
    .find((item) => item.type === type) || null;
}

export function createApproval({
  type,
  subject_id,
  subject_type = 'provider_profile',
  session_id = null,
  requested_by = 'system',
  role = 'system',
  reason = null,
  notes = null,
  metadata = {}
}) {
  const existing = findPendingApprovalBySubject({ type, subject_id, session_id });
  if (existing) return existing;

  const createdAt = nowIso();
  const approval = {
    approval_id: makeId('approval'),
    type,
    status: 'pending',
    created_at: createdAt,
    updated_at: createdAt,
    session_id,
    subject_id,
    subject_type,
    requested_by,
    requested_role: role,
    approved_by: null,
    rejected_by: null,
    reason,
    notes,
    metadata,
    history: []
  };

  withHistory(approval, 'approval_created', { requested_by, role, reason });
  writeJson(approvalFile(approval.approval_id), approval);
  return approval;
}

export function approveApproval(approvalId, { approved_by = 'system', role = 'system', notes = null } = {}) {
  const approval = getApproval(approvalId);
  if (!approval) return null;

  approval.status = 'approved';
  approval.approved_by = approved_by;
  approval.approved_role = role;
  approval.rejected_by = null;
  approval.rejected_role = null;
  if (notes != null) approval.notes = notes;
  withHistory(approval, 'approval_approved', { approved_by, role, notes });
  writeJson(approvalFile(approval.approval_id), approval);
  return approval;
}

export function rejectApproval(approvalId, { rejected_by = 'system', role = 'system', reason = null, notes = null } = {}) {
  const approval = getApproval(approvalId);
  if (!approval) return null;

  approval.status = 'rejected';
  approval.rejected_by = rejected_by;
  approval.rejected_role = role;
  approval.approved_by = null;
  approval.approved_role = null;
  if (reason != null) approval.reason = reason;
  if (notes != null) approval.notes = notes;
  withHistory(approval, 'approval_rejected', { rejected_by, role, reason, notes });
  writeJson(approvalFile(approval.approval_id), approval);
  return approval;
}
