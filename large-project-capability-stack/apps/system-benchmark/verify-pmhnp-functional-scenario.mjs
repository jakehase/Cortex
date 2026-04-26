#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getTier2Scenario } from './pmhnp-tier2-scenarios.mjs';

function parseArgs(argv) {
  const args = {
    scenarioId: null,
    singleCycle: false,
    durationMs: Number(process.env.PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS || 0),
    minCycles: Number(process.env.PMHNP_BENCHMARK_SCENARIO_MIN_CYCLES || 0)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--single-cycle') {
      args.singleCycle = true;
      continue;
    }
    if (token === '--duration-ms') {
      args.durationMs = Number(argv[index + 1] || 0);
      index += 1;
      continue;
    }
    if (token === '--min-cycles') {
      args.minCycles = Number(argv[index + 1] || 0);
      index += 1;
      continue;
    }
    if (!token.startsWith('--') && !args.scenarioId) {
      args.scenarioId = token;
    }
  }
  return {
    scenarioId: args.scenarioId,
    singleCycle: args.singleCycle,
    durationMs: Math.max(0, Number.isFinite(args.durationMs) ? args.durationMs : 0),
    minCycles: Math.max(0, Number.isFinite(args.minCycles) ? args.minCycles : 0)
  };
}

const args = parseArgs(process.argv.slice(2));
const scenarioId = args.scenarioId;
const repoRoot = process.cwd();

if (!scenarioId) {
  console.error('usage: node verify-pmhnp-functional-scenario.mjs <scenario-id>');
  process.exit(1);
}

const scenarioMeta = getTier2Scenario(scenarioId);
if (!scenarioMeta) {
  console.error(`unknown scenario: ${scenarioId}`);
  process.exit(1);
}

function setEnv(name, value) {
  process.env[name] = String(value);
}

function makeFixtureSnapshot(snapshotPath) {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify({
    generated_at: '2026-04-16T00:00:00.000Z',
    source: { type: 'tier2-fixture', run_id: 'tier2', finding_count: 1 },
    dashboard: { today_priorities: [], claims_at_risk: [], needs_review: [] },
    ask_agent: { suggested_prompts: ['tier2 fixture prompt'] }
  }, null, 2));
}

const temporaryRoots = new Set();

function cleanupTemporaryRoots() {
  for (const root of Array.from(temporaryRoots)) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    } catch {
      // best-effort temp cleanup
    }
    temporaryRoots.delete(root);
  }
}

process.on('exit', cleanupTemporaryRoots);
process.on('SIGINT', () => {
  cleanupTemporaryRoots();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanupTemporaryRoots();
  process.exit(143);
});

function setupIsolatedEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmhnp-tier2-'));
  temporaryRoots.add(root);
  const stateDir = path.join(root, 'state');
  const publicDir = path.join(root, 'public');
  const backupsDir = path.join(root, 'backups');
  const snapshotPath = path.join(publicDir, 'app', 'data', 'dashboard-snapshot.json');
  fs.mkdirSync(path.join(publicDir, 'app'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<html>public</html>\n');
  fs.writeFileSync(path.join(publicDir, 'app', 'index.html'), '<html>app</html>\n');
  fs.writeFileSync(path.join(publicDir, 'app', 'intake.html'), '<html>intake</html>\n');
  makeFixtureSnapshot(snapshotPath);

  setEnv('PMHNP_STATE_DIR', stateDir);
  setEnv('PMHNP_PUBLIC_DIR', publicDir);
  setEnv('PMHNP_SNAPSHOT_PATH', snapshotPath);
  setEnv('PMHNP_BACKUPS_DIR', backupsDir);
  setEnv('PMHNP_CLIENT_PORTAL_TOKEN', 'tier2-client-token');
  setEnv('PMHNP_OPERATIONAL_API_TOKEN', 'tier2-ops-token');
  setEnv('PMHNP_TOKEN_SIGNING_SECRET', 'tier2-signing-secret');
  setEnv('PMHNP_CLIENT_LOGIN_KEY', 'tier2-client-key');
  setEnv('PMHNP_REVIEWER_LOGIN_KEY', 'tier2-reviewer-key');
  setEnv('PMHNP_ADMIN_LOGIN_KEY', 'tier2-admin-key');
  setEnv('PMHNP_TOKEN_TTL_SECONDS', '3600');
  setEnv('PMHNP_ALLOW_LEGACY_STATIC_TOKENS', 'false');
  setEnv('PMHNP_REQUIRE_FORWARDED_TLS', 'false');
  setEnv('PMHNP_ENFORCE_OPERATIONAL_AUTH', 'false');
  setEnv('PMHNP_REQUIRE_ACTOR_HEADERS', 'false');
  setEnv('PMHNP_MINIMAL_HEALTH_RESPONSE', 'false');
  setEnv('PMHNP_LOG_SENSITIVE_STARTUP', 'false');

  return { root, stateDir, publicDir, backupsDir, snapshotPath };
}

async function importRepo(relPath) {
  return import(`${pathToFileURL(path.join(repoRoot, relPath)).href}?scenario=${encodeURIComponent(scenarioId)}&ts=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function parseJsonFromOutput(output) {
  const raw = String(output || '').trim();
  const candidate = raw.split('\n').map((line) => line.trim()).filter(Boolean).reverse().find((line) => line.startsWith('{')) || raw;
  return JSON.parse(candidate || '{}');
}

async function fetchJson(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function jsonHeaders(extra = {}) {
  return {
    'content-type': 'application/json',
    ...extra
  };
}

async function configRuntimeContract() {
  const ctx = setupIsolatedEnv();
  setEnv('PMHNP_REQUIRE_FORWARDED_TLS', 'true');
  setEnv('PMHNP_ENFORCE_OPERATIONAL_AUTH', 'true');
  setEnv('PMHNP_REQUIRE_ACTOR_HEADERS', 'true');
  setEnv('PMHNP_MINIMAL_HEALTH_RESPONSE', 'true');
  const config = await importRepo('src/config.mjs');
  assert.equal(config.STATE_DIR, ctx.stateDir);
  assert.equal(config.PUBLIC_DIR, ctx.publicDir);
  assert.equal(config.SNAPSHOT_PATH, ctx.snapshotPath);
  assert.equal(config.BACKUPS_DIR, ctx.backupsDir);
  assert.equal(config.OPERATIONAL_SECURITY.require_forwarded_tls, true);
  assert.equal(config.AUTH_CONFIG.client_login_key, 'tier2-client-key');
  assert.ok(config.CLIENT_PORTAL_AVAILABLE_ROUTES.includes('/v1/onboarding/tebra/activate'));
  return { stateDir: ctx.stateDir, routeCount: config.CLIENT_PORTAL_AVAILABLE_ROUTES.length };
}

async function approvalQueueLifecycle() {
  setupIsolatedEnv();
  const approvalQueue = await importRepo('src/domain/approvalQueue.mjs');
  const first = approvalQueue.createApproval({
    type: 'provider_profile_live_read_access',
    subject_id: 'profile-1',
    session_id: 'session-1',
    requested_by: 'ops-user',
    role: 'admin'
  });
  assert.equal(first.status, 'pending');
  const duplicate = approvalQueue.createApproval({
    type: 'provider_profile_live_read_access',
    subject_id: 'profile-1',
    session_id: 'session-1'
  });
  assert.equal(duplicate.approval_id, first.approval_id);
  const approved = approvalQueue.approveApproval(first.approval_id, { approved_by: 'reviewer-1', role: 'reviewer' });
  assert.equal(approved.status, 'approved');
  const second = approvalQueue.createApproval({
    type: 'provider_profile_live_read_access',
    subject_id: 'profile-2',
    session_id: 'session-2'
  });
  const rejected = approvalQueue.rejectApproval(second.approval_id, { rejected_by: 'reviewer-2', role: 'reviewer', reason: 'missing docs' });
  assert.equal(rejected.status, 'rejected');
  assert.ok(approvalQueue.listApprovals({ status: 'approved' }).length >= 1);
  assert.ok(approvalQueue.listApprovals({ status: 'rejected' }).length >= 1);
  return { approved: approved.approval_id, rejected: rejected.approval_id };
}

async function clientPortalSnapshotAggregation() {
  setupIsolatedEnv();
  const tebra = await importRepo('src/domain/tebraOnboarding.mjs');
  const clientPortal = await importRepo('src/domain/clientPortal.mjs');
  const actor = { actor_id: 'ops-user', role: 'admin' };
  const session = tebra.createOnboardingSession({
    practice_name: 'Snapshot Psychiatry',
    contact_name: 'Sam',
    contact_email: 'sam@example.com',
    environment: 'sandbox',
    tenant_id: 'tenant-snapshot',
    connection_mode: 'soap-admin-assisted',
    requested_adapter_mode: 'soap_api'
  }, actor);
  const activation = tebra.activateSession(session.session_id, actor);
  assert.equal(activation.ok, true);
  const snapshot = clientPortal.loadSnapshotForClient();
  assert.ok(snapshot.generated_at);
  assert.ok(snapshot.onboarding.sessions.some((item) => item.session_id === session.session_id));
  assert.ok(snapshot.automation.approvals.pending_count >= 1);
  assert.ok(snapshot.dashboard.today_priorities.length >= 1);
  return { pendingApprovals: snapshot.automation.approvals.pending_count, sessionId: session.session_id };
}

async function denialScoringFeedbackLearning() {
  setupIsolatedEnv();
  const denial = await importRepo('src/domain/denialWorkbench.mjs');
  const taxonomy = denial.getDenialTaxonomy();
  assert.ok(taxonomy.buckets.length >= 6);
  const scored = denial.scoreDenial({
    claim_ref: 'claim-1',
    payer: 'Aetna',
    denial_reason: 'invalid place of service telehealth modifier 95',
    pos: '02',
    modifier: '95',
    amount_at_risk: 180,
    claim_age_days: 14
  }, { actor_id: 'coder-1', role: 'reviewer' });
  assert.equal(scored.primary_match.denial_code, 'TEL-POS-MOD');
  const feedback = denial.recordDenialFeedback({
    claim_ref: 'claim-1',
    payer: 'Aetna',
    denial_reason: 'invalid place of service telehealth modifier 95',
    pos: '02',
    modifier: '95',
    amount_at_risk: 180,
    claim_age_days: 14,
    reviewer_label: 'TEL-POS-MOD',
    actual_outcome: 'appeal-won',
    reviewer_confirmed: true
  }, { actor_id: 'reviewer-1', role: 'reviewer' });
  assert.equal(feedback.ok, true);
  const artifactRun = denial.ingestDenialArtifacts({
    practice_name: 'Artifact Psychiatry',
    artifacts: [
      {
        name: 'claims.csv',
        format: 'csv',
        content_type: 'text/csv',
        content: [
          'claim_ref,payer,patient_name,denial_reason,pos,modifier,amount,claim_age_days',
          'c1,Aetna,Pat,invalid place of service telehealth,02,95,120,30',
          'c2,BCBS,Sam,timely filing expired,,,300,120'
        ].join('\n')
      }
    ]
  }, { actor_id: 'reviewer-user', role: 'reviewer' });
  assert.equal(artifactRun.ok, true);
  assert.equal(artifactRun.worklist.item_count, 2);
  assert.ok(artifactRun.worklist.totals.critical_or_high >= 1);
  assert.ok(denial.listDenialArtifacts().length >= 1);
  assert.ok(denial.listDenialWorklists().length >= 1);
  const stats = denial.getDenialLearningStats();
  assert.ok(stats.totals.feedback_records >= 1);
  assert.ok(stats.totals.reviewer_confirmed_outcomes >= 1);
  return {
    primaryCode: scored.primary_match.denial_code,
    feedbackRecords: stats.totals.feedback_records,
    worklistItems: artifactRun.worklist.item_count
  };
}

async function pilotMetricsRollup() {
  setupIsolatedEnv();
  const pilot = await importRepo('src/domain/pilotMetrics.mjs');
  const baseline = pilot.upsertPilotBaseline({
    practice_name: 'Tier2 Psychiatry',
    monthly_denials_before: 24,
    denial_rate_before_percent: 12,
    average_days_to_first_touch_before: 5,
    average_appeal_turnaround_days_before: 18,
    average_dollars_at_risk_per_month: 7200,
    billing_staff_hourly_cost: 30,
    pilot_cost_usd: 500
  }, { actor_id: 'ops-user', role: 'admin' });
  assert.equal(baseline.ok, true);
  const event = pilot.recordPilotEvent({
    practice_name: 'Tier2 Psychiatry',
    category: 'denial-ops',
    denials_reviewed: 10,
    denials_overturned: 4,
    prevented_denials: 2,
    dollars_recovered: 1400,
    dollars_protected: 600,
    staff_minutes_saved: 180,
    appeal_turnaround_days_improved: 6
  }, { actor_id: 'ops-user', role: 'admin' });
  assert.equal(event.ok, true);
  const report = pilot.generatePilotReport({ practice_name: 'Tier2 Psychiatry' }, { actor_id: 'ops-user', role: 'admin' });
  assert.equal(report.ok, true);
  assert.ok(report.report.event_count >= 1);
  assert.ok(report.report.totals.total_estimated_impact > 0);
  return { impact: report.report.totals.total_estimated_impact, roi: report.report.roi.estimated_roi_percent };
}

async function publicIntakeHybrid() {
  setupIsolatedEnv();
  const publicIntake = await importRepo('src/domain/publicIntake.mjs');
  const onboardingPacket = {
    practice_name: 'Hybrid Psychiatry',
    contact_name: 'Ava',
    contact_email: 'ava@example.com',
    environment: 'sandbox',
    tenant_id: 'tenant-hybrid',
    connection_mode: 'soap-admin-assisted',
    requested_adapter_mode: 'soap_api'
  };
  const uploadPacket = {
    practice_name: 'Upload Psychiatry',
    contact_name: 'Uma',
    contact_email: 'uma@example.com',
    environment: 'sandbox',
    tenant_id: 'tenant-upload',
    connection_mode: 'export-upload',
    requested_adapter_mode: 'export_upload'
  };
  const artifact = {
    name: 'patient_roster.csv',
    mime_type: 'text/csv',
    content_base64: Buffer.from('member_id,patient_name\n1,Test Patient\n').toString('base64')
  };
  const assisted = publicIntake.submitPublicIntake({ packet: onboardingPacket }, { ip: '1.1.1.1', website: '' });
  assert.equal(assisted.ok, true);
  assert.equal(assisted.intake.approval_required, true);
  const spam = publicIntake.submitPublicIntake({ packet: onboardingPacket, website: 'https://spam.example.com' }, { ip: '2.2.2.2', website: 'https://spam.example.com' });
  assert.equal(spam.ok, false);
  assert.equal(spam.error, 'PUBLIC_INTAKE_SPAM_BLOCKED');
  const upload = publicIntake.submitPublicIntake({ packet: uploadPacket, artifacts: [artifact] }, { ip: '3.3.3.3', website: '', artifacts: [artifact] });
  assert.equal(upload.ok, true);
  assert.equal(upload.intake.status, 'export_upload_ready');
  assert.equal(upload.upload_batch.summary.artifact_count, 1);
  return { assistedSession: assisted.intake.session_id, uploadBatchId: upload.upload_batch.batch_id };
}

async function tebraOnboardingLiveRead() {
  setupIsolatedEnv();
  const tebra = await importRepo('src/domain/tebraOnboarding.mjs');
  const actor = { actor_id: 'ops-user', role: 'admin' };
  const reviewer = { actor_id: 'reviewer-user', role: 'reviewer' };
  const session = tebra.createOnboardingSession({
    practice_name: 'Live Read Psychiatry',
    contact_name: 'Riley',
    contact_email: 'riley@example.com',
    environment: 'sandbox',
    tenant_id: 'tenant-live-read',
    connection_mode: 'soap-admin-assisted',
    requested_adapter_mode: 'soap_api'
  }, actor);
  const preflight = tebra.sessionPreflight(session.session_id, actor);
  assert.equal(preflight.ok, true);
  const activation = tebra.activateSession(session.session_id, actor);
  assert.equal(activation.ok, true);
  assert.equal(activation.approval.status, 'pending');
  const blocked = tebra.connectionTest({ session_id: session.session_id, adapter_mode: 'api_oauth' }, actor);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.error, 'TEBRA_MANUAL_REVIEW_PENDING');
  const approved = tebra.approveManualReview(session.session_id, reviewer);
  assert.equal(approved.ok, true);
  const connection = tebra.connectionTest({ session_id: session.session_id, adapter_mode: 'api_oauth' }, actor);
  assert.equal(connection.ok, true);
  assert.equal(connection.connection.read_only, true);
  const mapping = tebra.mappingValidate({
    session_id: session.session_id,
    mappings: {
      provider_identifier: 'prov-1',
      rendering_npi: '1234567890',
      billing_npi: '0987654321',
      service_location: 'main-office'
    }
  }, actor);
  assert.equal(mapping.ok, true);
  return { sessionId: session.session_id, approvalId: activation.approval.approval_id };
}

async function httpServerAuthGuards() {
  setupIsolatedEnv();
  const { createServer } = await importRepo('src/http/createServer.mjs');
  const server = createServer({
    clientToken: 'legacy-client',
    operationalToken: 'legacy-ops',
    security: {
      require_forwarded_tls: true,
      enforce_operational_auth: true,
      require_actor_headers: true
    },
    authConfig: {
      signing_secret: 'tier2-signing-secret',
      client_login_key: 'tier2-client-key',
      reviewer_login_key: 'tier2-reviewer-key',
      admin_login_key: 'tier2-admin-key',
      token_ttl_seconds: 3600,
      allow_legacy_static_tokens: false
    },
    healthConfig: {
      minimal_public_response: true
    }
  });
  server.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const health = await fetchJson(base, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    const tlsGate = await fetchJson(base, '/client/session');
    assert.equal(tlsGate.status, 403);
    assert.equal(tlsGate.body.error, 'OPERATIONAL_API_TLS_REQUIRED');
    const clientLogin = await fetchJson(base, '/v1/auth/client/login', {
      method: 'POST',
      headers: jsonHeaders({ 'x-forwarded-proto': 'https' }),
      body: JSON.stringify({ access_key: 'tier2-client-key', actor_id: 'client-user' })
    });
    assert.equal(clientLogin.status, 200);
    assert.ok(clientLogin.body.token);
    const clientSession = await fetchJson(base, '/client/session', {
      headers: {
        authorization: `Bearer ${clientLogin.body.token}`,
        'x-forwarded-proto': 'https'
      }
    });
    assert.equal(clientSession.status, 200);
    assert.equal(clientSession.body.user.role, 'client');
    const opsLogin = await fetchJson(base, '/v1/auth/ops/login', {
      method: 'POST',
      headers: jsonHeaders({ 'x-forwarded-proto': 'https' }),
      body: JSON.stringify({ access_key: 'tier2-admin-key', actor_id: 'admin-user' })
    });
    assert.equal(opsLogin.status, 200);
    const systemStatus = await fetchJson(base, '/v1/system/status', {
      headers: {
        authorization: `Bearer ${opsLogin.body.token}`,
        'x-forwarded-proto': 'https',
        'x-actor-id': 'admin-user',
        'x-role': 'admin'
      }
    });
    assert.equal(systemStatus.status, 200);
    assert.equal(systemStatus.body.ok, true);
    return { clientRole: clientSession.body.user.role, adminScopes: opsLogin.body.scopes.length };
  } finally {
    await closeServer(server);
  }
}

async function auditLogRoundtrip() {
  setupIsolatedEnv();
  const audit = await importRepo('src/lib/audit.mjs');
  const first = audit.appendAuditEvent({
    type: 'tier2.audit.test',
    actor: { actor_id: 'auditor', role: 'reviewer' },
    subject: { kind: 'test' },
    details: { ok: true }
  });
  assert.ok(first.event_id);
  const events = audit.listAuditEvents({ limit: 5 });
  assert.ok(events.some((item) => item.event_id === first.event_id));
  return { eventCount: events.length };
}

async function authTokenScopeContract() {
  setupIsolatedEnv();
  const auth = await importRepo('src/lib/authTokens.mjs');
  const authConfig = {
    signing_secret: 'tier2-signing-secret',
    client_login_key: 'tier2-client-key',
    reviewer_login_key: 'tier2-reviewer-key',
    admin_login_key: 'tier2-admin-key',
    token_ttl_seconds: 3600,
    allow_legacy_static_tokens: false
  };
  const client = auth.issueAccessToken({ accessKey: 'tier2-client-key', actorId: 'client-user', requestedScope: 'client', authConfig });
  assert.equal(client.ok, true);
  const verified = auth.verifyAccessToken(client.token, authConfig);
  assert.equal(verified.ok, true);
  assert.equal(auth.hasScopes(verified.payload, ['client']), true);
  assert.equal(auth.hasRole(verified.payload, ['client', 'admin']), true);
  const denied = auth.issueAccessToken({ accessKey: 'tier2-client-key', actorId: 'client-user', requestedScope: 'ops', authConfig });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'AUTH_SCOPE_NOT_ALLOWED');
  return { role: verified.payload.role, scopeCount: verified.payload.scopes.length };
}

async function storageRoundtrip() {
  const ctx = setupIsolatedEnv();
  const storage = await importRepo('src/lib/storage.mjs');
  const jsonPath = path.join(ctx.stateDir, 'records', 'one.json');
  storage.writeJson(jsonPath, { ok: true, count: 1 });
  assert.deepEqual(storage.readJson(jsonPath), { ok: true, count: 1 });
  const listDir = path.join(ctx.stateDir, 'records');
  storage.writeJson(path.join(listDir, 'two.json'), { ok: true, count: 2 });
  assert.equal(storage.listJson(listDir).length, 2);
  const ndjsonPath = path.join(ctx.stateDir, 'events', 'events.ndjson');
  storage.appendNdjson(ndjsonPath, { id: 1 });
  storage.appendNdjson(ndjsonPath, { id: 2 });
  assert.equal(storage.readNdjson(ndjsonPath).length, 2);
  assert.equal(storage.readNdjson(ndjsonPath, { limit: 1 })[0].id, 2);
  return { listCount: storage.listJson(listDir).length, latestNdjsonId: storage.readNdjson(ndjsonPath, { limit: 1 })[0].id };
}

async function opsServerStartupSurface() {
  setupIsolatedEnv();
  const { startOperationalServer } = await importRepo('src/ops/operationalHttpServerCli.mjs');
  const server = startOperationalServer({
    port: 0,
    clientToken: 'ops-client-token',
    operationalToken: 'ops-operational-token',
    security: {
      require_forwarded_tls: false,
      enforce_operational_auth: false,
      require_actor_headers: false
    },
    authConfig: {
      signing_secret: 'tier2-signing-secret',
      client_login_key: 'tier2-client-key',
      reviewer_login_key: 'tier2-reviewer-key',
      admin_login_key: 'tier2-admin-key',
      token_ttl_seconds: 3600,
      allow_legacy_static_tokens: true
    },
    healthConfig: {
      minimal_public_response: false
    }
  });
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const health = await fetchJson(base, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    const clientSession = await fetchJson(base, '/client/session', {
      headers: {
        authorization: 'Bearer ops-client-token'
      }
    });
    assert.equal(clientSession.status, 200);
    assert.equal(clientSession.body.user.auth, 'legacy-bearer-token');
    return { healthMode: health.body.mode, clientAuth: clientSession.body.user.auth };
  } finally {
    await closeServer(server);
  }
}

async function runScenario(handler, options = {}) {
  const minDurationMs = Math.max(0, Number(options.minDurationMs || 0));
  const minCycles = Math.max(1, Number(options.minCycles || (minDurationMs > 0 ? 2 : 1)));
  const cycleDetails = [];
  const startedAt = Date.now();
  const scenarioScriptPath = process.argv[1];
  let firstMeaningfulProgressMs = null;

  function runSingleCycleInChild(cycle) {
    const run = spawnSync(process.execPath, [scenarioScriptPath, '--single-cycle', scenarioId], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
      env: {
        ...process.env,
        PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS: '0',
        PMHNP_BENCHMARK_SCENARIO_MIN_CYCLES: '0'
      }
    });
    const parsed = parseJsonFromOutput(run.stdout || '{}');
    if (run.status !== 0 || parsed.ok === false) {
      const reason = parsed.error || parsed.stderr || run.stderr || `scenario_cycle_${cycle}_failed`;
      throw new Error(String(reason).trim());
    }
    return {
      details: parsed.details || null,
      firstMeaningfulProgressMs: Number(parsed.firstMeaningfulProgressMs || 0) > 0
        ? Number(parsed.firstMeaningfulProgressMs)
        : null
    };
  }

  while (true) {
    const cycle = cycleDetails.length + 1;
    const cycleStartedAt = Date.now();
    const details = minDurationMs > 0 || minCycles > 1
      ? runSingleCycleInChild(cycle)
      : { details: await handler({ cycle, startedAt }), firstMeaningfulProgressMs: Date.now() - startedAt };
    if (firstMeaningfulProgressMs == null) {
      firstMeaningfulProgressMs = Number(details?.firstMeaningfulProgressMs || 0) > 0
        ? Number(details.firstMeaningfulProgressMs)
        : Math.max(0, Date.now() - startedAt, Date.now() - cycleStartedAt);
    }
    cycleDetails.push({ cycle, details: details?.details ?? null });
    const elapsedMs = Date.now() - startedAt;
    if (cycleDetails.length >= minCycles && elapsedMs >= minDurationMs) {
      return {
        mode: minDurationMs > 0 ? 'endurance' : 'single_pass',
        cycleCount: cycleDetails.length,
        minDurationMs,
        minCycles,
        elapsedMs,
        firstMeaningfulProgressMs: firstMeaningfulProgressMs ?? elapsedMs,
        firstCycle: cycleDetails[0] || null,
        lastCycle: cycleDetails.at(-1) || null
      };
    }
  }
}

const scenarios = {
  config_runtime_contract: configRuntimeContract,
  approval_queue_lifecycle: approvalQueueLifecycle,
  client_portal_snapshot_aggregation: clientPortalSnapshotAggregation,
  denial_scoring_feedback_learning: denialScoringFeedbackLearning,
  pilot_metrics_rollup: pilotMetricsRollup,
  public_intake_hybrid: publicIntakeHybrid,
  tebra_onboarding_live_read: tebraOnboardingLiveRead,
  http_server_auth_guards: httpServerAuthGuards,
  audit_log_roundtrip: auditLogRoundtrip,
  auth_token_scope_contract: authTokenScopeContract,
  storage_roundtrip: storageRoundtrip,
  ops_server_startup_surface: opsServerStartupSurface
};

const startedAt = Date.now();
const startedAtIso = new Date(startedAt).toISOString();

try {
  const details = args.singleCycle
    ? await scenarios[scenarioId]({ cycle: 1, startedAt })
    : await runScenario(scenarios[scenarioId], {
      minDurationMs: args.durationMs,
      minCycles: args.minCycles
    });
  const durationMs = Date.now() - startedAt;
  const firstMeaningfulProgressMs = Number(details?.firstMeaningfulProgressMs || 0) > 0
    ? Number(details.firstMeaningfulProgressMs)
    : durationMs;
  console.log(JSON.stringify({
    ok: true,
    scenarioId,
    label: scenarioMeta.label,
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    durationMs,
    firstMeaningfulProgressMs,
    details
  }));
  process.exit(0);
} catch (error) {
  const durationMs = Date.now() - startedAt;
  console.log(JSON.stringify({
    ok: false,
    scenarioId,
    label: scenarioMeta.label,
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    durationMs,
    error: error?.message || String(error),
    stack: error?.stack || null
  }));
  process.exit(2);
}
