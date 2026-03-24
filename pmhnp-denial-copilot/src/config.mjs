import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '..');
export const PUBLIC_DIR = process.env.PMHNP_PUBLIC_DIR || path.join(ROOT_DIR, 'public');
export const STATE_DIR = process.env.PMHNP_STATE_DIR || path.join(ROOT_DIR, 'state');
export const SNAPSHOT_PATH = process.env.PMHNP_SNAPSHOT_PATH || path.join(PUBLIC_DIR, 'app', 'data', 'dashboard-snapshot.json');
export const BACKUPS_DIR = process.env.PMHNP_BACKUPS_DIR || path.join(ROOT_DIR, 'backups');
export const ONBOARDING_SESSIONS_DIR = path.join(STATE_DIR, 'tebra', 'onboarding-sessions');
export const PROVIDER_PROFILES_DIR = path.join(STATE_DIR, 'tebra', 'provider-profiles');
export const UPLOAD_BATCHES_DIR = path.join(STATE_DIR, 'tebra', 'upload-batches');
export const APPROVALS_DIR = path.join(STATE_DIR, 'approvals');
export const AUDIT_DIR = path.join(STATE_DIR, 'audit');
export const AUDIT_LOG_PATH = path.join(AUDIT_DIR, 'events.ndjson');

export const TRUTHS = Object.freeze({
  live_tebra_oauth: false,
  live_client_auth_provisioning: false,
  claim_auto_submission: false,
  pilot_manual_connection_request: true,
  local_onboarding_packet_builder: true,
  tebra_export_upload: true,
  tebra_admin_assisted_sync: true
});

export const AUTOMATION_POLICY = Object.freeze({
  auto_prepare_onboarding: true,
  auto_run_readonly_preflight: true,
  auto_activate_pilot_request: true,
  require_human_approval_for_live_reads: true,
  require_human_approval_for_writeback: true,
  writeback_enabled: false
});

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

export const OPERATIONAL_SECURITY = Object.freeze({
  require_forwarded_tls: envFlag('PMHNP_REQUIRE_FORWARDED_TLS', false),
  enforce_operational_auth: envFlag('PMHNP_ENFORCE_OPERATIONAL_AUTH', false),
  require_actor_headers: envFlag('PMHNP_REQUIRE_ACTOR_HEADERS', false)
});

export const AUTH_CONFIG = Object.freeze({
  signing_secret: process.env.PMHNP_TOKEN_SIGNING_SECRET || 'dev-signing-secret-change-me',
  client_login_key: process.env.PMHNP_CLIENT_LOGIN_KEY || 'dev-client-access',
  reviewer_login_key: process.env.PMHNP_REVIEWER_LOGIN_KEY || 'dev-reviewer-access',
  admin_login_key: process.env.PMHNP_ADMIN_LOGIN_KEY || 'dev-admin-access',
  token_ttl_seconds: Number(process.env.PMHNP_TOKEN_TTL_SECONDS || 3600),
  allow_legacy_static_tokens: envFlag('PMHNP_ALLOW_LEGACY_STATIC_TOKENS', true)
});

export const HEALTH_CONFIG = Object.freeze({
  minimal_public_response: envFlag('PMHNP_MINIMAL_HEALTH_RESPONSE', false)
});

export const REQUIRED_SESSION_FIELDS = Object.freeze([
  'practice.practice_name',
  'practice.contact_name',
  'practice.contact_email',
  'tebra.environment',
  'tebra.connection_mode'
]);

export const REQUIRED_MAPPINGS = Object.freeze([
  'provider_identifier',
  'rendering_npi',
  'billing_npi',
  'service_location'
]);

export const LIVE_READ_CONNECTION_READY_MODES = Object.freeze(['soap_api', 'api_oauth']);
export const UPLOAD_CONNECTION_READY_MODES = Object.freeze(['export_upload', 'export_feed']);
export const CONNECTION_READY_MODES = Object.freeze([...LIVE_READ_CONNECTION_READY_MODES, ...UPLOAD_CONNECTION_READY_MODES]);

export const CLIENT_PORTAL_AVAILABLE_ROUTES = Object.freeze([
  '/client/session',
  '/client/snapshot',
  '/health',
  '/v1/auth/client/login',
  '/v1/auth/ops/login',
  '/v1/public/tebra/intake',
  '/v1/system/status',
  '/v1/onboarding/tebra/session',
  '/v1/onboarding/tebra/sessions',
  '/v1/onboarding/tebra/provider-profiles',
  '/v1/onboarding/tebra/upload-batches',
  '/v1/onboarding/tebra/export-upload',
  '/v1/onboarding/tebra/intake/automate',
  '/v1/onboarding/tebra/preflight',
  '/v1/onboarding/tebra/connection-test',
  '/v1/onboarding/tebra/mapping-validate',
  '/v1/onboarding/tebra/activate',
  '/v1/onboarding/tebra/manual-review/approve',
  '/v1/onboarding/tebra/manual-review/reject',
  '/v1/approvals',
  '/v1/audit/events',
  '/v1/denials/taxonomy',
  '/v1/denials/score',
  '/v1/denials/feedback',
  '/v1/denials/learning',
  '/v1/denials/artifacts',
  '/v1/denials/worklists',
  '/v1/pilot/baseline',
  '/v1/pilot/event',
  '/v1/pilot/report'
]);
