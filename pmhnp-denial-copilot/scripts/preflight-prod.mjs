import fs from 'node:fs';
import path from 'node:path';

import { AUTH_CONFIG, BACKUPS_DIR, HEALTH_CONFIG, OPERATIONAL_SECURITY, PUBLIC_DIR, SNAPSHOT_PATH, STATE_DIR } from '../src/config.mjs';

const failures = [];
const warnings = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function note(message) {
  notes.push(message);
}

function checkWritableDir(label, dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
    note(`${label}: ${dirPath}`);
  } catch {
    fail(`${label} is not writable: ${dirPath}`);
  }
}

function notDefault(label, value, defaultValue) {
  if (String(value) === String(defaultValue)) {
    fail(`${label} is still using the development default.`);
  }
}

if (!OPERATIONAL_SECURITY.require_forwarded_tls) {
  fail('PMHNP_REQUIRE_FORWARDED_TLS must be enabled for production mode.');
}
if (!OPERATIONAL_SECURITY.enforce_operational_auth) {
  fail('PMHNP_ENFORCE_OPERATIONAL_AUTH must be enabled for production mode.');
}
if (!OPERATIONAL_SECURITY.require_actor_headers) {
  fail('PMHNP_REQUIRE_ACTOR_HEADERS must be enabled for production mode.');
}
if (!HEALTH_CONFIG.minimal_public_response) {
  fail('PMHNP_MINIMAL_HEALTH_RESPONSE should be enabled for production cutover parity.');
}
if (AUTH_CONFIG.allow_legacy_static_tokens) {
  fail('PMHNP_ALLOW_LEGACY_STATIC_TOKENS must be false for production mode.');
}

notDefault('PMHNP_TOKEN_SIGNING_SECRET', AUTH_CONFIG.signing_secret, 'dev-signing-secret-change-me');
notDefault('PMHNP_CLIENT_LOGIN_KEY', AUTH_CONFIG.client_login_key, 'dev-client-access');
notDefault('PMHNP_REVIEWER_LOGIN_KEY', AUTH_CONFIG.reviewer_login_key, 'dev-reviewer-access');
notDefault('PMHNP_ADMIN_LOGIN_KEY', AUTH_CONFIG.admin_login_key, 'dev-admin-access');

if (!Number.isFinite(AUTH_CONFIG.token_ttl_seconds) || AUTH_CONFIG.token_ttl_seconds < 300) {
  fail('PMHNP_TOKEN_TTL_SECONDS must be at least 300 seconds.');
}
if (AUTH_CONFIG.token_ttl_seconds > 86400) {
  warn('PMHNP_TOKEN_TTL_SECONDS is longer than 24 hours; review whether that is intentional.');
}

checkWritableDir('STATE_DIR', STATE_DIR);
checkWritableDir('BACKUPS_DIR', BACKUPS_DIR);

if (!fs.existsSync(PUBLIC_DIR)) {
  fail(`PUBLIC_DIR does not exist: ${PUBLIC_DIR}`);
} else {
  note(`PUBLIC_DIR: ${PUBLIC_DIR}`);
}

if (!fs.existsSync(SNAPSHOT_PATH)) {
  warn(`SNAPSHOT_PATH does not exist yet: ${SNAPSHOT_PATH}`);
} else {
  note(`SNAPSHOT_PATH: ${SNAPSHOT_PATH}`);
}

const requiredFiles = [
  path.join(PUBLIC_DIR, 'index.html'),
  path.join(PUBLIC_DIR, 'app', 'index.html'),
  path.join(PUBLIC_DIR, 'app', 'intake.html')
];
for (const filePath of requiredFiles) {
  if (!fs.existsSync(filePath)) {
    fail(`Required public file is missing: ${filePath}`);
  }
}

const summary = {
  ok: failures.length === 0,
  failures,
  warnings,
  notes
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
