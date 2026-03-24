import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  AUTOMATION_POLICY,
  LIVE_READ_CONNECTION_READY_MODES,
  ONBOARDING_SESSIONS_DIR,
  PROVIDER_PROFILES_DIR,
  REQUIRED_MAPPINGS,
  REQUIRED_SESSION_FIELDS,
  TRUTHS,
  UPLOAD_BATCHES_DIR,
  UPLOAD_CONNECTION_READY_MODES
} from '../config.mjs';
import {
  approveApproval,
  createApproval,
  findPendingApprovalBySubject,
  latestApprovalBySubject,
  rejectApproval
} from './approvalQueue.mjs';
import { appendAuditEvent } from '../lib/audit.mjs';
import { clone, ensureDir, listJson, makeId, nowIso, readJson, toFileSlug, writeJson } from '../lib/storage.mjs';

const LIVE_READ_APPROVAL_TYPE = 'provider_profile_live_read_access';
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const RECOMMENDED_UPLOAD_CATEGORIES = Object.freeze(['patient_roster', 'claims_report', 'appointment_export']);
const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.csv', '.xlsx', '.xls', '.xml', '.json', '.txt', '.zip', '.edi', '.837', '.835']);

function cleanString(value) {
  const text = value == null ? '' : String(value);
  return text.trim();
}

function normalizeActor(actor = {}) {
  return {
    actor_id: cleanString(actor.actor_id) || 'system',
    role: cleanString(actor.role) || 'system'
  };
}

function actorInfo(actor = {}) {
  const normalized = normalizeActor(actor);
  return {
    actor_id: normalized.actor_id,
    actor_role: normalized.role
  };
}

function normalizeConnectionMode(raw) {
  const value = cleanString(raw).toLowerCase();
  if (!value || value === 'pilot-assisted') return 'soap-admin-assisted';
  if (['soap-admin-assisted', 'soap_api_assisted', 'soap-assisted', 'soap-api-assisted'].includes(value)) return 'soap-admin-assisted';
  if (['export-upload', 'export_upload', 'upload-first-hybrid', 'upload-first'].includes(value)) return 'export-upload';
  if (value === 'direct-oauth-not-live') return 'direct-oauth-not-live';
  return value;
}

function defaultAdapterModeForConnection(connectionMode) {
  if (connectionMode === 'export-upload') return 'export_upload';
  if (connectionMode === 'direct-oauth-not-live') return 'direct_oauth_not_live';
  return 'soap_api';
}

function canonicalAdapterMode(adapterMode) {
  const value = cleanString(adapterMode).toLowerCase();
  if (!value || value === 'soap_api' || value === 'api_oauth') return 'soap_api';
  if (value === 'export_upload' || value === 'export-feed' || value === 'export_feed') return 'export_upload';
  return value;
}

function isUploadConnectionMode(connectionMode) {
  return normalizeConnectionMode(connectionMode) === 'export-upload';
}

function isLiveReadConnectionMode(connectionMode) {
  return normalizeConnectionMode(connectionMode) === 'soap-admin-assisted';
}

function normalizePacket(input = {}) {
  const packet = input.packet && typeof input.packet === 'object' ? input.packet : input;

  const practiceInput = packet.practice || packet;
  const tebraInput = packet.tebra || packet;
  const connectionMode = normalizeConnectionMode(tebraInput.connection_mode || packet.connection_mode);

  return {
    packet_version: packet.packet_version || 'pmhnp_onboarding_v2_hybrid',
    generated_at: packet.generated_at || nowIso(),
    status: packet.status || 'intake_captured',
    truths: clone(TRUTHS),
    practice: {
      practice_name: cleanString(practiceInput.practice_name),
      contact_name: cleanString(practiceInput.contact_name),
      contact_email: cleanString(practiceInput.contact_email),
      contact_phone: cleanString(practiceInput.contact_phone) || null
    },
    tebra: {
      environment: cleanString(tebraInput.environment || tebraInput.tebra_environment),
      tenant_id: cleanString(tebraInput.tenant_id || tebraInput.tebra_tenant_id) || null,
      connection_mode: connectionMode
    },
    notes: cleanString(packet.notes) || null,
    requested_adapter_mode: canonicalAdapterMode(cleanString(packet.requested_adapter_mode) || defaultAdapterModeForConnection(connectionMode)),
    hybrid_strategy: {
      mode: 'hybrid',
      primary_lane: connectionMode === 'export-upload' ? 'export_upload' : 'soap_api',
      secondary_lane: connectionMode === 'export-upload' ? 'soap_api' : 'export_upload'
    }
  };
}

function getValueByPath(target, pointer) {
  return pointer.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), target);
}

function requiredSessionFieldGaps(session) {
  return REQUIRED_SESSION_FIELDS.filter((pointer) => !cleanString(getValueByPath(session, pointer)));
}

function sessionFile(sessionId) {
  return path.join(ONBOARDING_SESSIONS_DIR, `${sessionId}.json`);
}

function profileFile(profileId) {
  return path.join(PROVIDER_PROFILES_DIR, `${profileId}.json`);
}

function uploadBatchFile(batchId) {
  return path.join(UPLOAD_BATCHES_DIR, `${batchId}.json`);
}

function uploadBatchArtifactsDir(batchId) {
  return path.join(UPLOAD_BATCHES_DIR, batchId);
}

function safeFilename(name, fallback = 'artifact') {
  const cleaned = cleanString(name).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function summarizeApproval(approval, required = AUTOMATION_POLICY.require_human_approval_for_live_reads) {
  if (!approval) {
    return {
      required,
      status: required ? 'pending' : 'not-required',
      approval_id: null
    };
  }

  return {
    required: true,
    approval_id: approval.approval_id,
    status: approval.status,
    type: approval.type,
    requested_by: approval.requested_by,
    approved_by: approval.approved_by,
    rejected_by: approval.rejected_by,
    updated_at: approval.updated_at
  };
}

function approvalForProfile(profileId, sessionId = null) {
  return latestApprovalBySubject({ type: LIVE_READ_APPROVAL_TYPE, subject_id: profileId, session_id: sessionId });
}

function withSavedSession(session) {
  writeJson(sessionFile(session.session_id), session);
  return session;
}

function withSavedProfile(profile) {
  writeJson(profileFile(profile.profile_id), profile);
  return profile;
}

function withSavedUploadBatch(batch) {
  writeJson(uploadBatchFile(batch.batch_id), batch);
  return batch;
}

function appendHistory(record, event, details = {}) {
  record.history = record.history || [];
  record.history.push({ at: nowIso(), event, details });
  record.updated_at = nowIso();
  return record;
}

function normalizeArtifactCategory(filename) {
  const lower = filename.toLowerCase();
  if (/(patient|demographic|roster)/.test(lower)) return 'patient_roster';
  if (/(appointment|encounter|schedule|visit)/.test(lower)) return 'appointment_export';
  if (/(claim|charge|ar|aging|denial|recon|ledger)/.test(lower)) return 'claims_report';
  if (/(payment|era|835|deposit)/.test(lower)) return 'payment_report';
  if (/(auth|authorization|precert|referral)/.test(lower)) return 'authorization_report';
  return 'other';
}

function artifactWarnings(summary) {
  const warnings = [];
  if (summary.missing_recommended_categories.length) {
    warnings.push({
      code: 'TEBRA_EXPORT_BATCH_PARTIAL',
      message: `Upload is usable now, but adding ${summary.missing_recommended_categories.join(', ')} would improve review quality.`
    });
  }
  return warnings;
}

function latestUploadBatchForSession(sessionId) {
  return listUploadBatches().find((batch) => batch.session_id === sessionId) || null;
}

function uploadSummaryForSession(sessionId) {
  const batch = latestUploadBatchForSession(sessionId);
  return batch ? batch.summary : null;
}

function normalizeArtifacts(artifacts = []) {
  if (!Array.isArray(artifacts)) return { ok: false, error: 'TEBRA_EXPORT_ARTIFACTS_REQUIRED', message: 'Artifacts array is required.' };
  if (!artifacts.length) return { ok: false, error: 'TEBRA_EXPORT_ARTIFACTS_REQUIRED', message: 'Upload at least one export file.' };

  let totalBytes = 0;
  const normalized = [];

  for (const raw of artifacts) {
    const name = safeFilename(raw?.name || raw?.filename || 'artifact');
    const ext = path.extname(name).toLowerCase();
    if (ext && !ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      return {
        ok: false,
        error: 'TEBRA_EXPORT_ARTIFACT_TYPE_BLOCKED',
        message: `Unsupported artifact type for ${name}. Allowed types: ${Array.from(ALLOWED_UPLOAD_EXTENSIONS).join(', ')}`
      };
    }

    const base64 = cleanString(raw?.content_base64 || raw?.contentBase64 || raw?.data_base64 || raw?.dataBase64);
    if (!base64) {
      return { ok: false, error: 'TEBRA_EXPORT_ARTIFACT_EMPTY', message: `Artifact ${name} did not include file content.` };
    }

    let buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      return { ok: false, error: 'TEBRA_EXPORT_ARTIFACT_DECODE_FAILED', message: `Artifact ${name} could not be decoded.` };
    }

    if (!buffer.length) {
      return { ok: false, error: 'TEBRA_EXPORT_ARTIFACT_EMPTY', message: `Artifact ${name} was empty.` };
    }

    totalBytes += buffer.length;
    if (totalBytes > MAX_UPLOAD_BYTES) {
      return {
        ok: false,
        error: 'TEBRA_EXPORT_BATCH_TOO_LARGE',
        message: `Upload exceeded ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB. Split the batch or upload fewer files.`
      };
    }

    normalized.push({
      artifact_id: makeId('artifact'),
      name,
      mime_type: cleanString(raw?.mime_type || raw?.mimeType || raw?.type) || 'application/octet-stream',
      byte_count: buffer.length,
      buffer,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      category: normalizeArtifactCategory(name)
    });
  }

  return { ok: true, artifacts: normalized, totalBytes };
}

function buildUploadSummary(artifacts, totalBytes) {
  const categories = Array.from(new Set(artifacts.map((item) => item.category))).sort();
  const missingRecommendedCategories = RECOMMENDED_UPLOAD_CATEGORIES.filter((item) => !categories.includes(item));
  return {
    artifact_count: artifacts.length,
    total_bytes: totalBytes,
    categories_found: categories,
    missing_recommended_categories: missingRecommendedCategories,
    ready_for_export_ingest: artifacts.length > 0
  };
}

function createBaseProfile(session, normalizedActor) {
  const createdAt = nowIso();
  return {
    profile_id: makeId(`pp_${toFileSlug(session.practice.practice_name, 'practice')}`),
    session_id: session.session_id,
    created_at: createdAt,
    updated_at: createdAt,
    status: 'pending_manual_review',
    source_of_truth: 'tebra',
    practice: clone(session.practice),
    tebra: {
      environment: session.tebra.environment,
      tenant_id: session.tebra.tenant_id,
      connection_mode: session.tebra.connection_mode,
      manual_pilot_request_required: isLiveReadConnectionMode(session.tebra.connection_mode),
      live_oauth_click_attach: false,
      upload_artifacts_required: isUploadConnectionMode(session.tebra.connection_mode),
      hybrid_strategy: clone(session.hybrid_strategy)
    },
    adapter: {
      read_only: true,
      fail_closed: true,
      connection_ready_modes: [],
      manual_provisioning_required: isLiveReadConnectionMode(session.tebra.connection_mode),
      live_read_ready: false,
      writeback_enabled: false,
      notes: 'Profile created from hybrid onboarding. Human review still gates live reads; export uploads can be reviewed immediately.'
    },
    history: []
  };
}

export function listSessions() {
  return listJson(ONBOARDING_SESSIONS_DIR)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

export function listProviderProfiles() {
  return listJson(PROVIDER_PROFILES_DIR)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

export function listUploadBatches() {
  return listJson(UPLOAD_BATCHES_DIR)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

export function getSession(sessionId) {
  return readJson(sessionFile(sessionId), null);
}

export function getProviderProfile(profileId) {
  return readJson(profileFile(profileId), null);
}

export function getUploadBatch(batchId) {
  return readJson(uploadBatchFile(batchId), null);
}

export function findProviderProfileBySession(sessionId) {
  return listProviderProfiles().find((profile) => profile.session_id === sessionId) || null;
}

export function createOnboardingSession(input = {}, actor = {}) {
  const normalizedActor = normalizeActor(actor);
  const packet = normalizePacket(input);
  const createdAt = nowIso();
  const sessionId = makeId('tebra_sess');

  const session = {
    session_id: sessionId,
    created_at: createdAt,
    updated_at: createdAt,
    status: packet.tebra.connection_mode === 'export-upload' ? 'export_upload_requested' : 'intake_captured',
    truths: clone(TRUTHS),
    automation_policy: clone(AUTOMATION_POLICY),
    practice: packet.practice,
    tebra: packet.tebra,
    notes: packet.notes,
    requested_adapter_mode: packet.requested_adapter_mode,
    hybrid_strategy: packet.hybrid_strategy,
    packet_version: packet.packet_version,
    generated_at: packet.generated_at,
    upload_batches: [],
    latest_upload_batch_id: null,
    history: []
  };

  appendHistory(session, 'session_created', {
    connection_mode: session.tebra.connection_mode,
    requested_adapter_mode: session.requested_adapter_mode,
    environment: session.tebra.environment,
    ...actorInfo(normalizedActor)
  });

  withSavedSession(session);
  appendAuditEvent({
    type: 'tebra.session.created',
    actor: normalizedActor,
    subject: { kind: 'onboarding_session', session_id: session.session_id },
    details: {
      connection_mode: session.tebra.connection_mode,
      requested_adapter_mode: session.requested_adapter_mode,
      environment: session.tebra.environment
    }
  });
  return session;
}

export function createUploadBatch({ session_id, artifacts = [], notes = null } = {}, actor = {}) {
  const normalizedActor = normalizeActor(actor);
  const session = getSession(session_id);
  if (!session) {
    return {
      ok: false,
      fail_closed: true,
      status: 404,
      error: 'TEBRA_SESSION_NOT_FOUND',
      message: 'Cannot attach export uploads without a valid onboarding session.'
    };
  }

  const normalizedArtifacts = normalizeArtifacts(artifacts);
  if (!normalizedArtifacts.ok) {
    appendAuditEvent({
      type: 'tebra.export_upload.blocked',
      actor: normalizedActor,
      subject: { kind: 'onboarding_session', session_id },
      details: { error: normalizedArtifacts.error }
    });
    return {
      ok: false,
      fail_closed: true,
      status: 422,
      error: normalizedArtifacts.error,
      message: normalizedArtifacts.message
    };
  }

  const batchId = makeId('tebra_upload');
  const artifactDir = uploadBatchArtifactsDir(batchId);
  ensureDir(artifactDir);

  const storedArtifacts = normalizedArtifacts.artifacts.map((artifact) => {
    const storedName = `${artifact.artifact_id}__${safeFilename(artifact.name)}`;
    const relativePath = path.join(batchId, storedName);
    fs.writeFileSync(path.join(artifactDir, storedName), artifact.buffer);
    return {
      artifact_id: artifact.artifact_id,
      name: artifact.name,
      mime_type: artifact.mime_type,
      byte_count: artifact.byte_count,
      sha256: artifact.sha256,
      category: artifact.category,
      storage_relative_path: relativePath,
      uploaded_at: nowIso()
    };
  });

  const summary = buildUploadSummary(storedArtifacts, normalizedArtifacts.totalBytes);
  const batch = {
    batch_id: batchId,
    session_id,
    practice_name: session.practice.practice_name,
    created_at: nowIso(),
    updated_at: nowIso(),
    status: 'received',
    actor: normalizedActor,
    notes: cleanString(notes) || null,
    summary,
    artifacts: storedArtifacts,
    warnings: artifactWarnings(summary)
  };
  withSavedUploadBatch(batch);

  session.upload_batches = Array.isArray(session.upload_batches) ? session.upload_batches : [];
  session.upload_batches.unshift(batchId);
  session.latest_upload_batch_id = batchId;
  session.requested_adapter_mode = 'export_upload';
  session.tebra.connection_mode = 'export-upload';
  session.status = 'export_upload_received';
  appendHistory(session, 'export_batch_uploaded', {
    batch_id: batchId,
    artifact_count: summary.artifact_count,
    categories_found: summary.categories_found,
    ...actorInfo(normalizedActor)
  });
  withSavedSession(session);

  appendAuditEvent({
    type: 'tebra.export_upload.received',
    actor: normalizedActor,
    subject: { kind: 'upload_batch', batch_id: batch.batch_id, session_id },
    details: {
      artifact_count: summary.artifact_count,
      total_bytes: summary.total_bytes,
      categories_found: summary.categories_found
    }
  });

  return {
    ok: true,
    status: 201,
    batch,
    session,
    message: 'Tebra export upload batch captured.'
  };
}

export function sessionPreflight(sessionOrId, actor = {}) {
  const normalizedActor = normalizeActor(actor);
  const session = typeof sessionOrId === 'string' ? getSession(sessionOrId) : sessionOrId;
  if (!session) {
    return {
      ok: false,
      fail_closed: true,
      status: 404,
      error: 'TEBRA_SESSION_NOT_FOUND',
      message: 'Tebra onboarding session was not found'
    };
  }

  const missing_fields = requiredSessionFieldGaps(session);
  const warnings = [];
  const blockers = [];
  const connectionMode = normalizeConnectionMode(session.tebra.connection_mode);
  const latestUploadSummary = uploadSummaryForSession(session.session_id);

  if (session.tebra.environment === 'unknown') {
    warnings.push({
      code: 'TEBRA_ENVIRONMENT_UNKNOWN',
      message: 'Tebra environment is not confirmed yet; pilot team may need to verify it manually.'
    });
  }

  if (!session.tebra.tenant_id && isLiveReadConnectionMode(connectionMode)) {
    warnings.push({
      code: 'TEBRA_TENANT_ID_UNKNOWN',
      message: 'Tebra tenant ID is not populated yet; admin-assisted SOAP setup may need to collect it manually.'
    });
  }

  if (missing_fields.length) {
    blockers.push({
      code: 'PROVIDER_PROFILE_INCOMPLETE',
      message: 'Required onboarding fields are missing; fail closed rather than pretending attach readiness.',
      missing_fields
    });
  }

  if (connectionMode === 'direct-oauth-not-live') {
    blockers.push({
      code: 'LIVE_TEBRA_OAUTH_DISABLED',
      message: 'Direct self-serve OAuth is not live in this recovered build.'
    });
  }

  if (isUploadConnectionMode(connectionMode) && !latestUploadSummary?.artifact_count) {
    blockers.push({
      code: 'TEBRA_EXPORT_BATCH_MISSING',
      message: 'Upload at least one Tebra export before activation can continue.'
    });
  }

  const ready_for_manual_pilot_request = blockers.length === 0 && isLiveReadConnectionMode(connectionMode);
  const ready_for_export_ingest = blockers.length === 0 && isUploadConnectionMode(connectionMode);
  const result = {
    ok: blockers.length === 0,
    fail_closed: blockers.length > 0,
    status: blockers.length ? 422 : 200,
    truths: clone(TRUTHS),
    session_id: session.session_id,
    connection_mode: connectionMode,
    warnings: [
      ...warnings,
      ...(latestUploadSummary ? artifactWarnings(latestUploadSummary) : [])
    ],
    blockers,
    missing_fields,
    readiness: {
      ready_for_manual_pilot_request,
      ready_for_export_ingest,
      ready_for_live_oauth_click_attach: false,
      provider_profile_complete: missing_fields.length === 0,
      manual_pilot_required: isLiveReadConnectionMode(connectionMode),
      upload_batch_present: Boolean(latestUploadSummary?.artifact_count)
    },
    next_actions: ready_for_export_ingest
      ? [
          'Review uploaded export files inside the PMHNP workspace.',
          'Validate mappings against the uploaded exports.',
          'Optionally add SOAP/admin-assisted sync later for continuous updates.'
        ]
      : ready_for_manual_pilot_request
        ? [
            'Create or update the provider profile for admin-assisted SOAP attach.',
            'Submit the live-read request for manual review.',
            'Approve the profile for live-read access before running connection tests.'
          ]
        : [
            'Fill the missing onboarding fields.',
            isUploadConnectionMode(connectionMode)
              ? 'Upload a Tebra export batch to continue with the easier path.'
              : 'Use admin-assisted SOAP setup instead of direct OAuth.',
            'Re-run preflight before activation.'
          ]
  };

  appendAuditEvent({
    type: result.ok ? 'tebra.preflight.passed' : 'tebra.preflight.blocked',
    actor: normalizedActor,
    subject: { kind: 'onboarding_session', session_id: session.session_id },
    details: {
      warnings: result.warnings.map((item) => item.code),
      blockers: blockers.map((item) => item.code),
      missing_fields,
      connection_mode: connectionMode
    }
  });

  return result;
}

export function activateSession(sessionId, actor = {}) {
  const normalizedActor = normalizeActor(actor);
  const session = getSession(sessionId);
  if (!session) {
    return {
      ok: false,
      fail_closed: true,
      status: 404,
      error: 'TEBRA_SESSION_NOT_FOUND',
      message: 'Cannot activate a session that does not exist.'
    };
  }

  const preflight = sessionPreflight(session, normalizedActor);
  if (!preflight.ok) {
    appendAuditEvent({
      type: 'tebra.activation.blocked',
      actor: normalizedActor,
      subject: { kind: 'onboarding_session', session_id: session.session_id },
      details: { blockers: preflight.blockers.map((item) => item.code) }
    });
    return {
      ok: false,
      fail_closed: true,
      status: preflight.status,
      error: 'TEBRA_PRECHECK_FAILED',
      message: 'Activation blocked because preflight did not pass.',
      preflight
    };
  }

  const connectionMode = normalizeConnectionMode(session.tebra.connection_mode);
  let profile = findProviderProfileBySession(session.session_id) || createBaseProfile(session, normalizedActor);

  if (isUploadConnectionMode(connectionMode)) {
    const uploadSummary = uploadSummaryForSession(session.session_id);
    profile.status = 'ready_for_export_ingest';
    profile.source_of_truth = 'tebra_exports';
    profile.tebra.connection_mode = 'export-upload';
    profile.tebra.manual_pilot_request_required = false;
    profile.tebra.upload_artifacts_required = true;
    profile.adapter.connection_ready_modes = [...UPLOAD_CONNECTION_READY_MODES];
    profile.adapter.live_read_ready = false;
    profile.adapter.fail_closed = false;
    profile.adapter.manual_provisioning_required = false;
    profile.adapter.notes = 'Export-upload lane is ready. Files are available for ingestion/review without live Tebra reads.';
    appendHistory(profile, 'export_upload_ready', {
      session_id: session.session_id,
      latest_upload_batch_id: session.latest_upload_batch_id,
      artifact_count: uploadSummary?.artifact_count || 0,
      ...actorInfo(normalizedActor)
    });
    withSavedProfile(profile);

    session.provider_profile_id = profile.profile_id;
    session.approval_id = null;
    session.status = 'export_upload_ready';
    appendHistory(session, 'activate_requested', {
      provider_profile_id: profile.profile_id,
      lane: 'export_upload',
      ...actorInfo(normalizedActor)
    });
    withSavedSession(session);

    appendAuditEvent({
      type: 'tebra.activation.requested',
      actor: normalizedActor,
      subject: { kind: 'onboarding_session', session_id: session.session_id, profile_id: profile.profile_id },
      details: { lane: 'export_upload', latest_upload_batch_id: session.latest_upload_batch_id }
    });

    return {
      ok: true,
      status: 202,
      truths: clone(TRUTHS),
      automation_policy: clone(AUTOMATION_POLICY),
      session,
      provider_profile: profile,
      approval: summarizeApproval(null, false),
      message: 'Export-upload lane is ready. The PMHNP team can review the uploaded Tebra exports immediately.'
    };
  }

  appendHistory(profile, 'manual_pilot_requested', {
    session_id: session.session_id,
    ...actorInfo(normalizedActor)
  });
  profile.status = 'pending_manual_review';
  profile.source_of_truth = 'tebra';
  profile.tebra.connection_mode = 'soap-admin-assisted';
  profile.tebra.manual_pilot_request_required = true;
  profile.tebra.upload_artifacts_required = false;
  profile.adapter.connection_ready_modes = [];
  profile.adapter.live_read_ready = false;
  profile.adapter.fail_closed = true;
  profile.adapter.manual_provisioning_required = true;
  profile.adapter.notes = 'Profile created from admin-assisted SOAP onboarding. Manual review/approval is required before live-read connection tests pass.';
  withSavedProfile(profile);

  let approval = null;
  if (AUTOMATION_POLICY.require_human_approval_for_live_reads) {
    approval = createApproval({
      type: LIVE_READ_APPROVAL_TYPE,
      subject_id: profile.profile_id,
      session_id: session.session_id,
      requested_by: normalizedActor.actor_id,
      role: normalizedActor.role,
      reason: 'Manual approval is required before enabling read-only live Tebra SOAP access.',
      notes: 'Hybrid strategy keeps export uploads easy, but live SOAP reads remain human-gated.',
      metadata: {
        practice_name: session.practice.practice_name,
        connection_mode: session.tebra.connection_mode,
        environment: session.tebra.environment
      }
    });
    appendAuditEvent({
      type: 'tebra.approval.created',
      actor: normalizedActor,
      subject: { kind: 'provider_profile', profile_id: profile.profile_id, session_id: session.session_id },
      details: { approval_id: approval.approval_id, approval_type: approval.type }
    });
  }

  session.provider_profile_id = profile.profile_id;
  session.approval_id = approval?.approval_id || session.approval_id || null;
  session.status = 'pilot_manual_connection_requested';
  appendHistory(session, 'activate_requested', {
    provider_profile_id: profile.profile_id,
    approval_id: session.approval_id,
    lane: 'soap_api',
    ...actorInfo(normalizedActor)
  });
  withSavedSession(session);

  appendAuditEvent({
    type: 'tebra.activation.requested',
    actor: normalizedActor,
    subject: { kind: 'onboarding_session', session_id: session.session_id, profile_id: profile.profile_id },
    details: { approval_id: session.approval_id, lane: 'soap_api' }
  });

  return {
    ok: true,
    status: 202,
    truths: clone(TRUTHS),
    automation_policy: clone(AUTOMATION_POLICY),
    session,
    provider_profile: profile,
    approval: approval ? summarizeApproval(approval) : summarizeApproval(null),
    message: 'Admin-assisted SOAP connection request created. Manual review is still required before live-read tests will pass.'
  };
}

export function approveManualReview(sessionId, actor = {}) {
  const normalizedActor = normalizeActor(actor);
  const session = getSession(sessionId);
  if (!session) {
    return {
      ok: false,
      fail_closed: true,
      status: 404,
      error: 'TEBRA_SESSION_NOT_FOUND',
      message: 'Cannot approve manual review without an onboarding session.'
    };
  }

  const profile = findProviderProfileBySession(sessionId);
  if (!profile) {
    return {
      ok: false,
      fail_closed: true,
      status: 404,
      error: 'TEBRA_PROVIDER_PROFILE_MISSING',
      message: 'Provider profile does not exist yet; activate the session first.'
    };
  }

  const pendingApproval = findPendingApprovalBySubject({
    type: LIVE_READ_APPROVAL_TYPE,
    subject_id: profile.profile_id,
    session_id: session.session_id
  });

  if (!pendingApproval) {
    const latestApproval = approvalForProfile(profile.profile_id, session.session_id);
    return {
      ok: false,
      fail_closed: true,
      status: 409,
      error: 'TEBRA_APPROVAL_NOT_PENDING',
      message: 'Manual review approval is not pending for this provider profile.',
      approval: summarizeApproval(latestApproval)
    };
  }

  const approval = approveApproval(pendingApproval.approval_id, {
    approved_by: normalizedActor.actor_id,
    role: normalizedActor.role
  });

  profile.status = 'ready_for_live_reads';
  profile.adapter.live_read_ready = true;
  profile.adapter.connection_ready_modes = [...LIVE_READ_CONNECTION_READY_MODES];
  profile.adapter.fail_closed = false;
  appendHistory(profile, 'manual_review_approved', {
    approval_id: approval.approval_id,
    ...actorInfo(normalizedActor)
  });
  withSavedProfile(profile);

  session.status = 'pilot_live_read_ready';
  session.approval_id = approval.approval_id;
  appendHistory(session, 'manual_review_approved', {
    approval_id: approval.approval_id,
    provider_profile_id: profile.profile_id,
    ...actorInfo(normalizedActor)
  });
  withSavedSession(session);

  appendAuditEvent({
    type: 'tebra.approval.approved',
    actor: normalizedActor,
    subject: { kind: 'provider_profile', profile_id: profile.profile_id, session_id: session.session_id },
    details: { approval_id: approval.approval_id }
  });

  return {
    ok: true,
    status: 200,
    truths: clone(TRUTHS),
    session,
    provider_profile: profile,
    approval: summarizeApproval(approval),
    message: 'Manual review approved. Read-only SOAP live-read paths are now ready for connection tests.'
  };
}

function rejectManualReviewState(session, profile, rejection, actor) {
  profile.status = 'manual_review_rejected';
  profile.adapter.live_read_ready = false;
  profile.adapter.fail_closed = true;
  profile.adapter.connection_ready_modes = [];
  appendHistory(profile, 'manual_review_rejected', {
    approval_id: rejection.approval_id,
    reason: rejection.reason,
    ...actorInfo(actor)
  });
  withSavedProfile(profile);

  session.status = 'pilot_manual_review_rejected';
  session.approval_id = rejection.approval_id;
  appendHistory(session, 'manual_review_rejected', {
    approval_id: rejection.approval_id,
    provider_profile_id: profile.profile_id,
    reason: rejection.reason,
    ...actorInfo(actor)
  });
  withSavedSession(session);

  appendAuditEvent({
    type: 'tebra.approval.rejected',
    actor,
    subject: { kind: 'provider_profile', profile_id: profile.profile_id, session_id: session.session_id },
    details: { approval_id: rejection.approval_id, reason: rejection.reason }
  });

  return {
    ok: true,
    status: 200,
    truths: clone(TRUTHS),
    session,
    provider_profile: profile,
    approval: summarizeApproval(rejection),
    message: 'Manual review rejected. Live-read access remains blocked until a new approval request is created.'
  };
}

export function rejectManualReview(sessionId, actor = {}, reason = null) {
  const normalizedActor = normalizeActor(actor);
  const session = getSession(sessionId);
  if (!session) {
    return {
      ok: false,
      fail_closed: true,
      status: 404,
      error: 'TEBRA_SESSION_NOT_FOUND',
      message: 'Cannot reject manual review without an onboarding session.'
    };
  }

  const profile = findProviderProfileBySession(sessionId);
  if (!profile) {
    return {
      ok: false,
      fail_closed: true,
      status: 404,
      error: 'TEBRA_PROVIDER_PROFILE_MISSING',
      message: 'Provider profile does not exist yet; activate the session first.'
    };
  }

  const pendingApproval = findPendingApprovalBySubject({
    type: LIVE_READ_APPROVAL_TYPE,
    subject_id: profile.profile_id,
    session_id: session.session_id
  });

  if (!pendingApproval) {
    const latestApproval = approvalForProfile(profile.profile_id, session.session_id);
    return {
      ok: false,
      fail_closed: true,
      status: 409,
      error: 'TEBRA_APPROVAL_NOT_PENDING',
      message: 'Manual review rejection is not pending for this provider profile.',
      approval: summarizeApproval(latestApproval)
    };
  }

  const rejection = rejectApproval(pendingApproval.approval_id, {
    rejected_by: normalizedActor.actor_id,
    role: normalizedActor.role,
    reason: cleanString(reason) || 'Manual review rejected live-read readiness.',
    notes: 'Approval queue rejected before live-read enablement.'
  });

  return rejectManualReviewState(session, profile, rejection, normalizedActor);
}

export function automateIntake(input = {}, actor = {}) {
  const normalizedActor = normalizeActor(actor);
  const session = createOnboardingSession(input, normalizedActor);
  const preflight = AUTOMATION_POLICY.auto_run_readonly_preflight
    ? sessionPreflight(session, normalizedActor)
    : null;

  let activation = null;
  if (
    AUTOMATION_POLICY.auto_prepare_onboarding &&
    AUTOMATION_POLICY.auto_activate_pilot_request &&
    isLiveReadConnectionMode(session.tebra.connection_mode) &&
    preflight?.ok
  ) {
    activation = activateSession(session.session_id, normalizedActor);
  }

  appendAuditEvent({
    type: 'tebra.automation.intake_prepared',
    actor: normalizedActor,
    subject: { kind: 'onboarding_session', session_id: session.session_id },
    details: {
      preflight_ok: Boolean(preflight?.ok),
      activation_status: activation?.ok ? activation.session?.status : null,
      connection_mode: session.tebra.connection_mode
    }
  });

  return {
    ok: true,
    status: 201,
    truths: clone(TRUTHS),
    automation_policy: clone(AUTOMATION_POLICY),
    session,
    preflight,
    activation,
    approval: activation?.approval || summarizeApproval(null, false),
    message: activation?.ok
      ? 'Onboarding intake captured and admin-assisted SOAP request automatically prepared. Human approval is still required before live reads.'
      : 'Onboarding intake captured. Additional work is still required before the chosen lane is ready.'
  };
}

export function connectionTest({ session_id, adapter_mode = 'api_oauth' } = {}, actor = {}) {
  const normalizedActor = normalizeActor(actor);
  const session = getSession(session_id);
  const canonicalMode = canonicalAdapterMode(adapter_mode);
  if (!session) {
    return {
      ok: false,
      fail_closed: true,
      status: 404,
      error: 'TEBRA_SESSION_NOT_FOUND',
      message: 'Cannot test connection without a valid onboarding session.'
    };
  }

  const profile = findProviderProfileBySession(session_id);
  if (!profile) {
    appendAuditEvent({
      type: 'tebra.connection_test.blocked',
      actor: normalizedActor,
      subject: { kind: 'onboarding_session', session_id },
      details: { reason: 'provider_profile_missing' }
    });
    return {
      ok: false,
      fail_closed: true,
      status: 409,
      error: 'TEBRA_PROVIDER_PROFILE_INCOMPLETE',
      message: 'Provider profile is not provisioned yet; fail closed until activation creates one.',
      missing_fields: requiredSessionFieldGaps(session)
    };
  }

  if (canonicalMode === 'export_upload') {
    const uploadBatch = latestUploadBatchForSession(session_id);
    if (!uploadBatch) {
      appendAuditEvent({
        type: 'tebra.connection_test.blocked',
        actor: normalizedActor,
        subject: { kind: 'onboarding_session', session_id },
        details: { reason: 'upload_batch_missing' }
      });
      return {
        ok: false,
        fail_closed: true,
        status: 409,
        error: 'TEBRA_EXPORT_BATCH_MISSING',
        message: 'Export-upload lane is not ready until a Tebra export batch has been uploaded.'
      };
    }

    if (!profile.adapter.connection_ready_modes.includes('export_upload')) {
      appendAuditEvent({
        type: 'tebra.connection_test.blocked',
        actor: normalizedActor,
        subject: { kind: 'provider_profile', profile_id: profile.profile_id, session_id },
        details: { reason: 'adapter_mode_not_ready', adapter_mode: canonicalMode }
      });
      return {
        ok: false,
        fail_closed: true,
        status: 422,
        error: 'TEBRA_ADAPTER_MODE_NOT_READY',
        message: 'Export-upload mode is not ready for this provider profile.',
        ready_modes: profile.adapter.connection_ready_modes
      };
    }

    const response = {
      ok: true,
      status: 200,
      truths: clone(TRUTHS),
      approval: summarizeApproval(null, false),
      connection: {
        provider_profile_id: profile.profile_id,
        adapter_mode: 'export_upload',
        source_of_truth: 'tebra_exports',
        read_only: true,
        writeback_enabled: false,
        live_oauth_click_attach: false,
        manual_provisioning_required: false,
        connection_state: 'ready_for_export_ingest',
        latest_upload_batch_id: uploadBatch.batch_id,
        artifact_count: uploadBatch.summary.artifact_count
      },
      message: 'Export-upload readiness check passed in recovered dev mode.'
    };

    appendHistory(session, 'connection_test_passed', {
      adapter_mode: 'export_upload',
      provider_profile_id: profile.profile_id,
      latest_upload_batch_id: uploadBatch.batch_id,
      ...actorInfo(normalizedActor)
    });
    withSavedSession(session);
    appendAuditEvent({
      type: 'tebra.connection_test.passed',
      actor: normalizedActor,
      subject: { kind: 'provider_profile', profile_id: profile.profile_id, session_id },
      details: { adapter_mode: 'export_upload', latest_upload_batch_id: uploadBatch.batch_id }
    });
    return response;
  }

  const approval = approvalForProfile(profile.profile_id, session.session_id);
  if (AUTOMATION_POLICY.require_human_approval_for_live_reads && approval?.status !== 'approved') {
    appendAuditEvent({
      type: 'tebra.connection_test.blocked',
      actor: normalizedActor,
      subject: { kind: 'provider_profile', profile_id: profile.profile_id, session_id },
      details: { approval_status: approval?.status || 'missing' }
    });

    if (approval?.status === 'rejected') {
      return {
        ok: false,
        fail_closed: true,
        status: 409,
        error: 'TEBRA_MANUAL_REVIEW_REJECTED',
        message: 'Provider profile exists, but manual review rejected live-read access.',
        approval: summarizeApproval(approval),
        provider_profile: profile
      };
    }

    return {
      ok: false,
      fail_closed: true,
      status: 409,
      error: 'TEBRA_MANUAL_REVIEW_PENDING',
      message: 'Provider profile exists, but manual review has not approved live-read access yet.',
      approval: summarizeApproval(approval),
      provider_profile: profile
    };
  }

  if (!profile.adapter.connection_ready_modes.includes(canonicalMode) && !profile.adapter.connection_ready_modes.includes('api_oauth')) {
    appendAuditEvent({
      type: 'tebra.connection_test.blocked',
      actor: normalizedActor,
      subject: { kind: 'provider_profile', profile_id: profile.profile_id, session_id },
      details: { reason: 'adapter_mode_not_ready', adapter_mode: canonicalMode }
    });
    return {
      ok: false,
      fail_closed: true,
      status: 422,
      error: 'TEBRA_ADAPTER_MODE_NOT_READY',
      message: `Adapter mode ${adapter_mode} is not ready for this provider profile.`,
      ready_modes: profile.adapter.connection_ready_modes
    };
  }

  const response = {
    ok: true,
    status: 200,
    truths: clone(TRUTHS),
    approval: summarizeApproval(approval),
    connection: {
      provider_profile_id: profile.profile_id,
      adapter_mode: 'soap_api',
      source_of_truth: 'tebra',
      read_only: true,
      writeback_enabled: false,
      live_oauth_click_attach: false,
      manual_provisioning_required: true,
      connection_state: 'ready_for_live_reads'
    },
    message: 'Read-only SOAP connection test passed in recovered dev mode.'
  };

  appendHistory(session, 'connection_test_passed', {
    adapter_mode: 'soap_api',
    provider_profile_id: profile.profile_id,
    approval_id: approval?.approval_id,
    ...actorInfo(normalizedActor)
  });
  withSavedSession(session);
  appendAuditEvent({
    type: 'tebra.connection_test.passed',
    actor: normalizedActor,
    subject: { kind: 'provider_profile', profile_id: profile.profile_id, session_id },
    details: { adapter_mode: 'soap_api', approval_id: approval?.approval_id }
  });
  return response;
}

export function mappingValidate({ session_id, mappings = {} } = {}, actor = {}) {
  const normalizedActor = normalizeActor(actor);
  const session = getSession(session_id);
  if (!session) {
    return {
      ok: false,
      fail_closed: true,
      status: 404,
      error: 'TEBRA_SESSION_NOT_FOUND',
      message: 'Cannot validate mappings without a valid onboarding session.'
    };
  }

  const normalized = Object.fromEntries(
    Object.entries(mappings || {}).map(([key, value]) => [key, cleanString(value)])
  );

  const missing_mappings = REQUIRED_MAPPINGS.filter((key) => !normalized[key]);
  if (missing_mappings.length) {
    appendAuditEvent({
      type: 'tebra.mapping_validation.blocked',
      actor: normalizedActor,
      subject: { kind: 'onboarding_session', session_id },
      details: { missing_mappings }
    });
    return {
      ok: false,
      fail_closed: true,
      status: 422,
      error: 'TEBRA_MAPPING_INCOMPLETE',
      message: 'Required mappings are missing; fail closed rather than assume safe defaults.',
      missing_mappings,
      required_mappings: [...REQUIRED_MAPPINGS]
    };
  }

  appendHistory(session, 'mapping_validated', {
    fields: Object.keys(normalized),
    ...actorInfo(normalizedActor)
  });
  withSavedSession(session);
  appendAuditEvent({
    type: 'tebra.mapping_validation.passed',
    actor: normalizedActor,
    subject: { kind: 'onboarding_session', session_id },
    details: { fields: Object.keys(normalized) }
  });
  return {
    ok: true,
    status: 200,
    session_id: session.session_id,
    mappings: normalized,
    message: 'Mapping validation passed for the recovered hybrid contract.'
  };
}
