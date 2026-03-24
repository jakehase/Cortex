import { appendAuditEvent } from '../lib/audit.mjs';
import {
  activateSession,
  automateIntake,
  createOnboardingSession,
  createUploadBatch,
  sessionPreflight
} from './tebraOnboarding.mjs';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;
const recentRequestsByIp = new Map();

function cleanString(value) {
  return String(value == null ? '' : value).trim();
}

function nowMs() {
  return Date.now();
}

function normalizeEmail(value) {
  return cleanString(value).toLowerCase();
}

function publicIp(requestMeta = {}) {
  return cleanString(requestMeta.ip) || 'unknown-ip';
}

function normalizeConnectionMode(value) {
  const normalized = cleanString(value).toLowerCase();
  if (!normalized || normalized === 'pilot-assisted') return 'soap-admin-assisted';
  if (['soap-admin-assisted', 'soap_api_assisted', 'soap-assisted', 'soap-api-assisted'].includes(normalized)) return 'soap-admin-assisted';
  if (['export-upload', 'export_upload', 'upload-first', 'upload-first-hybrid'].includes(normalized)) return 'export-upload';
  if (normalized === 'direct-oauth-not-live') return 'direct-oauth-not-live';
  return normalized;
}

function pruneAndCount(ip) {
  const now = nowMs();
  const current = (recentRequestsByIp.get(ip) || []).filter((ts) => now - ts < WINDOW_MS);
  recentRequestsByIp.set(ip, current);
  return current;
}

function recordRequest(ip) {
  const current = pruneAndCount(ip);
  current.push(nowMs());
  recentRequestsByIp.set(ip, current);
  return current.length;
}

function extractPacket(input = {}) {
  return input && typeof input.packet === 'object' ? input.packet : input;
}

function packetSummary(packet) {
  const practice = packet.practice || packet;
  const tebra = packet.tebra || packet;
  const connectionMode = normalizeConnectionMode(tebra.connection_mode || packet.connection_mode);
  return {
    practice_name: cleanString(practice.practice_name),
    contact_name: cleanString(practice.contact_name),
    contact_email: normalizeEmail(practice.contact_email),
    environment: cleanString(tebra.environment || tebra.tebra_environment),
    connection_mode: connectionMode,
    requested_adapter_mode: cleanString(packet.requested_adapter_mode) || (connectionMode === 'export-upload' ? 'export_upload' : 'soap_api')
  };
}

function validatePacket(packet, requestMeta = {}) {
  const summary = packetSummary(packet);
  const errors = [];
  const website = cleanString(requestMeta.website || packet.website || packet.company_website || packet.url);
  const artifacts = Array.isArray(requestMeta.artifacts || packet.artifacts) ? (requestMeta.artifacts || packet.artifacts) : [];

  if (website) {
    errors.push({ code: 'PUBLIC_INTAKE_SPAM_BLOCKED', message: 'Spam guard triggered.' });
  }

  if (!summary.practice_name) {
    errors.push({ code: 'PRACTICE_NAME_REQUIRED', message: 'Practice name is required.' });
  }
  if (!summary.contact_name) {
    errors.push({ code: 'CONTACT_NAME_REQUIRED', message: 'Primary contact name is required.' });
  }
  if (!summary.contact_email || !summary.contact_email.includes('@')) {
    errors.push({ code: 'CONTACT_EMAIL_REQUIRED', message: 'A valid contact email is required.' });
  }
  if (!summary.environment) {
    errors.push({ code: 'TEBRA_ENVIRONMENT_REQUIRED', message: 'Tebra environment is required.' });
  }
  if (!summary.connection_mode) {
    errors.push({ code: 'CONNECTION_MODE_REQUIRED', message: 'Connection mode is required.' });
  }

  if (summary.connection_mode === 'export-upload' && artifacts.length === 0) {
    errors.push({
      code: 'TEBRA_EXPORT_ARTIFACTS_REQUIRED',
      message: 'Upload at least one Tebra export file to use the easiest import path.'
    });
  }

  const ip = publicIp(requestMeta);
  const current = pruneAndCount(ip);
  if (current.length >= MAX_REQUESTS_PER_WINDOW) {
    errors.push({
      code: 'PUBLIC_INTAKE_RATE_LIMITED',
      message: 'Please wait a few minutes before submitting another intake request.'
    });
  }

  return { summary, errors, artifacts };
}

function auditBlocked(summary, ip, errors) {
  appendAuditEvent({
    type: 'public.intake.blocked',
    actor: { actor_id: `public:${summary.contact_email || ip}`, role: 'public-intake' },
    subject: { kind: 'public_intake', ip },
    details: { errors: errors.map((item) => item.code), practice_name: summary.practice_name }
  });
}

function publicActor(summary, ip) {
  return {
    actor_id: summary.contact_email || `public:${ip}`,
    role: 'public-intake'
  };
}

export function submitPublicIntake(input = {}, requestMeta = {}) {
  const packet = extractPacket(input);
  const { summary, errors, artifacts } = validatePacket(packet, requestMeta);
  const ip = publicIp(requestMeta);

  if (errors.length) {
    auditBlocked(summary, ip, errors);
    return {
      ok: false,
      status: errors.some((item) => item.code === 'PUBLIC_INTAKE_RATE_LIMITED') ? 429 : 422,
      error: errors[0].code,
      message: errors[0].message,
      details: errors
    };
  }

  recordRequest(ip);

  const actor = publicActor(summary, ip);

  if (summary.connection_mode === 'export-upload') {
    const session = createOnboardingSession(packet, actor);
    const upload = createUploadBatch({
      session_id: session.session_id,
      artifacts,
      notes: cleanString(packet.notes) || null
    }, actor);

    if (!upload.ok) {
      appendAuditEvent({
        type: 'public.intake.export_upload_blocked',
        actor,
        subject: { kind: 'public_intake', session_id: session.session_id, ip },
        details: { error: upload.error }
      });

      return {
        ok: false,
        status: upload.status || 422,
        error: upload.error,
        message: upload.message,
        intake: {
          session_id: session.session_id,
          practice_name: summary.practice_name,
          contact_email: summary.contact_email,
          status: 'captured_with_blockers',
          approval_required: false,
          next_steps: [
            'Your onboarding session was created.',
            'Please fix the upload issue and resubmit your Tebra exports.',
            'We can still help manually if needed.'
          ],
          warnings: [],
          blockers: [{ code: upload.error, message: upload.message }]
        }
      };
    }

    const preflight = sessionPreflight(session.session_id, actor);
    const activation = preflight.ok ? activateSession(session.session_id, actor) : null;

    appendAuditEvent({
      type: 'public.intake.submitted',
      actor,
      subject: { kind: 'public_intake', session_id: session.session_id, ip },
      details: {
        practice_name: summary.practice_name,
        environment: summary.environment,
        connection_mode: summary.connection_mode,
        activation_ok: Boolean(activation?.ok),
        upload_batch_id: upload.batch?.batch_id || null
      }
    });

    return {
      ok: true,
      status: 201,
      message: activation?.ok
        ? 'Intake captured and Tebra export upload is ready for review.'
        : 'Intake captured and exports uploaded, but a reviewer still needs to resolve blockers.',
      intake: {
        session_id: session.session_id,
        practice_name: summary.practice_name,
        contact_email: summary.contact_email,
        status: activation?.ok ? 'export_upload_ready' : 'captured_with_blockers',
        approval_required: false,
        next_steps: activation?.ok
          ? [
              'Our team can review your uploaded Tebra exports immediately.',
              'We may ask for one more export type if key categories are missing.',
              'If you later want continuous sync, we can add the admin-assisted SOAP path.'
            ]
          : [
              'Your onboarding session and upload batch were saved.',
              'A reviewer still needs to resolve blockers shown below before activation can continue.',
              'We may contact you for missing export files or unclear details.'
            ],
        warnings: preflight.warnings || upload.batch?.warnings || [],
        blockers: preflight.blockers || []
      },
      upload_batch: upload.batch,
      preflight,
      activation
    };
  }

  const run = automateIntake(packet, actor);

  appendAuditEvent({
    type: 'public.intake.submitted',
    actor,
    subject: { kind: 'public_intake', session_id: run.session?.session_id || null, ip },
    details: {
      practice_name: summary.practice_name,
      environment: summary.environment,
      connection_mode: summary.connection_mode,
      activation_ok: Boolean(run.activation?.ok)
    }
  });

  return {
    ok: true,
    status: 201,
    message: run.activation?.ok
      ? 'Intake captured. We created your onboarding session and queued the admin-assisted live-sync path for manual review.'
      : 'Intake captured. We created your onboarding session, but a reviewer still needs to resolve remaining blockers.',
    intake: {
      session_id: run.session?.session_id || null,
      practice_name: summary.practice_name,
      contact_email: summary.contact_email,
      status: run.activation?.ok ? 'queued_for_manual_review' : 'captured_with_blockers',
      approval_required: true,
      next_steps: run.activation?.ok
        ? [
            'Our team will review your onboarding packet.',
            'A manual approval step is still required before live SOAP reads are enabled.',
            'We may contact you if anything in the intake packet needs clarification.'
          ]
        : [
            'Your onboarding packet was saved.',
            'A reviewer still needs to resolve the blockers shown below before activation can continue.',
            'We may contact you for missing or unclear details.'
          ],
      warnings: run.preflight?.warnings || [],
      blockers: run.preflight?.blockers || []
    },
    preflight: run.preflight,
    activation: run.activation
  };
}
