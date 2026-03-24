import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pmhnp-smoke-'));
const stateDir = path.join(tempRoot, 'state');
const publicDir = path.join(tempRoot, 'public');
const snapshotPath = path.join(publicDir, 'app', 'data', 'dashboard-snapshot.json');

fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
fs.writeFileSync(snapshotPath, JSON.stringify({
  generated_at: '2026-03-16T00:00:00.000Z',
  source: { type: 'test-fixture', run_id: 'smoke', finding_count: 1 },
  dashboard: { today_priorities: [], claims_at_risk: [], needs_review: [] },
  ask_agent: { suggested_prompts: ['fixture prompt'] }
}, null, 2));

process.env.PMHNP_STATE_DIR = stateDir;
process.env.PMHNP_PUBLIC_DIR = publicDir;
process.env.PMHNP_SNAPSHOT_PATH = snapshotPath;
process.env.PMHNP_CLIENT_PORTAL_TOKEN = 'smoke-token';

const { startOperationalServer } = await import('../src/ops/operationalHttpServerCli.mjs');

const server = startOperationalServer({ port: 0, clientToken: 'smoke-token' });
await new Promise((resolve) => server.once('listening', resolve));

const { port } = server.address();
const base = `http://127.0.0.1:${port}`;
const OPS_HEADERS = { 'x-actor-id': 'smoke-ops', 'x-role': 'ops' };
const REVIEW_HEADERS = { 'x-actor-id': 'smoke-reviewer', 'x-role': 'reviewer' };
let strictServer = null;

async function request(pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  let body = null;
  const text = await response.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

function jsonRequest(pathname, payload, headers = {}, method = 'POST') {
  return request(pathname, {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    body: payload == null ? undefined : JSON.stringify(payload)
  });
}

try {
  {
    const { response, body } = await request('/health');
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.mode, 'recovered-dev');
    assert.equal(body.automation_policy.auto_prepare_onboarding, true);
  }

  {
    const { response, body } = await request('/client/session');
    assert.equal(response.status, 401);
    assert.equal(body.error, 'CLIENT_PORTAL_AUTH_REQUIRED');
  }

  {
    const { response, body } = await request('/client/snapshot', {
      headers: { authorization: 'Bearer wrong-token' }
    });
    assert.equal(response.status, 401);
    assert.equal(body.error, 'CLIENT_PORTAL_AUTH_INVALID');
    assert.equal(body.message, 'Client access token format is invalid');
  }

  {
    const { response, body } = await request('/client/session', {
      headers: { authorization: 'Bearer smoke-token' }
    });
    assert.equal(response.status, 200);
    assert.equal(body.automation_policy.auto_activate_pilot_request, true);
    assert.ok(body.available_routes.includes('/v1/approvals'));
    assert.ok(body.available_routes.includes('/v1/audit/events'));
  }

  const onboardingPacket = {
    practice_name: 'Smoke Test Psychiatry',
    contact_name: 'Jake',
    contact_email: 'jake@example.com',
    environment: 'sandbox',
    tenant_id: 'tenant-smoke',
    connection_mode: 'soap-admin-assisted',
    requested_adapter_mode: 'soap_api'
  };

  const uploadPacket = {
    practice_name: 'Upload First Psychiatry',
    contact_name: 'Uma',
    contact_email: 'uma@example.com',
    environment: 'sandbox',
    tenant_id: 'tenant-upload',
    connection_mode: 'export-upload',
    requested_adapter_mode: 'export_upload'
  };

  const uploadArtifact = {
    name: 'patient_roster.csv',
    mime_type: 'text/csv',
    content_base64: Buffer.from('member_id,patient_name\n1,Test Patient\n').toString('base64')
  };

  {
    const { response, body } = await jsonRequest('/v1/public/tebra/intake', {
      packet: onboardingPacket,
      website: ''
    });
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.intake.practice_name, onboardingPacket.practice_name);
    assert.equal(body.intake.approval_required, true);
  }

  {
    const { response, body } = await jsonRequest('/v1/public/tebra/intake', {
      packet: onboardingPacket,
      website: 'https://spam.example.com'
    });
    assert.equal(response.status, 422);
    assert.equal(body.error, 'PUBLIC_INTAKE_SPAM_BLOCKED');
  }

  {
    const { response, body } = await jsonRequest('/v1/public/tebra/intake', {
      packet: uploadPacket,
      website: '',
      artifacts: [uploadArtifact]
    });
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.intake.practice_name, uploadPacket.practice_name);
    assert.equal(body.intake.approval_required, false);
    assert.equal(body.intake.status, 'export_upload_ready');
    assert.equal(body.upload_batch.summary.artifact_count, 1);
    assert.equal(body.activation.provider_profile.status, 'ready_for_export_ingest');
  }

  let sessionId;
  let approvalId;
  {
    const { response, body } = await jsonRequest('/v1/onboarding/tebra/session', onboardingPacket, OPS_HEADERS);
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    sessionId = body.session.session_id;
    assert.ok(sessionId);
  }

  {
    const { response, body } = await jsonRequest('/v1/onboarding/tebra/preflight', { session_id: sessionId }, OPS_HEADERS);
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.readiness.ready_for_manual_pilot_request, true);
  }

  {
    const { response, body } = await jsonRequest('/v1/onboarding/tebra/activate', { session_id: sessionId }, OPS_HEADERS);
    assert.equal(response.status, 202);
    assert.equal(body.ok, true);
    assert.equal(body.provider_profile.status, 'pending_manual_review');
    assert.equal(body.approval.status, 'pending');
    approvalId = body.approval.approval_id;
    assert.ok(approvalId);
  }

  {
    const { response, body } = await request('/v1/onboarding/tebra/sessions');
    assert.equal(response.status, 200);
    assert.ok(body.sessions.some((item) => item.session_id === sessionId));
  }

  {
    const { response, body } = await request('/v1/onboarding/tebra/provider-profiles');
    assert.equal(response.status, 200);
    assert.ok(body.provider_profiles.some((item) => item.session_id === sessionId));
  }

  {
    const { response, body } = await request('/v1/approvals?status=pending');
    assert.equal(response.status, 200);
    assert.ok(body.approvals.some((item) => item.approval_id === approvalId));
  }

  {
    const { response, body } = await request(`/v1/approvals/${approvalId}`);
    assert.equal(response.status, 200);
    assert.equal(body.approval.status, 'pending');
    assert.equal(body.approval.requested_by, 'smoke-ops');
  }

  {
    const { response, body } = await jsonRequest('/v1/onboarding/tebra/connection-test', {
      session_id: sessionId,
      adapter_mode: 'api_oauth'
    }, OPS_HEADERS);
    assert.equal(response.status, 409);
    assert.equal(body.error, 'TEBRA_MANUAL_REVIEW_PENDING');
    assert.equal(body.approval.approval_id, approvalId);
  }

  {
    const { response, body } = await request(`/v1/approvals/${approvalId}/approve`, {
      method: 'POST',
      headers: REVIEW_HEADERS
    });
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.provider_profile.status, 'ready_for_live_reads');
    assert.equal(body.approval.status, 'approved');
    assert.equal(body.approval.approved_by, 'smoke-reviewer');
  }

  {
    const { response, body } = await jsonRequest('/v1/onboarding/tebra/connection-test', {
      session_id: sessionId,
      adapter_mode: 'api_oauth'
    }, OPS_HEADERS);
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.connection.read_only, true);
    assert.equal(body.approval.status, 'approved');
  }

  {
    const { response, body } = await jsonRequest('/v1/onboarding/tebra/mapping-validate', {
      session_id: sessionId,
      mappings: {
        provider_identifier: 'prov-1',
        rendering_npi: '1234567890',
        billing_npi: '0987654321',
        service_location: 'main-office'
      }
    }, OPS_HEADERS);
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
  }

  const automatedPacket = {
    packet: {
      practice_name: 'Automation Clinic',
      contact_name: 'Ava',
      contact_email: 'ava@example.com',
      environment: 'sandbox',
      tenant_id: 'tenant-auto',
      connection_mode: 'soap-admin-assisted',
      requested_adapter_mode: 'soap_api'
    }
  };

  let autoSessionId;
  let autoApprovalId;
  let replacementApprovalId;
  {
    const { response, body } = await jsonRequest('/v1/onboarding/tebra/intake/automate', automatedPacket, OPS_HEADERS);
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.activation.ok, true);
    assert.equal(body.approval.status, 'pending');
    autoSessionId = body.session.session_id;
    autoApprovalId = body.approval.approval_id;
    assert.ok(autoSessionId);
    assert.ok(autoApprovalId);
  }

  {
    const { response, body } = await jsonRequest('/v1/onboarding/tebra/connection-test', {
      session_id: autoSessionId,
      adapter_mode: 'api_oauth'
    }, OPS_HEADERS);
    assert.equal(response.status, 409);
    assert.equal(body.error, 'TEBRA_MANUAL_REVIEW_PENDING');
  }

  {
    const { response, body } = await jsonRequest(`/v1/approvals/${autoApprovalId}/reject`, {
      reason: 'Need supporting documents before live-read approval.'
    }, REVIEW_HEADERS);
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.approval.status, 'rejected');
    assert.equal(body.approval.rejected_by, 'smoke-reviewer');
  }

  {
    const { response, body } = await jsonRequest('/v1/onboarding/tebra/connection-test', {
      session_id: autoSessionId,
      adapter_mode: 'api_oauth'
    }, OPS_HEADERS);
    assert.equal(response.status, 409);
    assert.equal(body.error, 'TEBRA_MANUAL_REVIEW_REJECTED');
    assert.equal(body.approval.status, 'rejected');
  }

  {
    const { response, body } = await jsonRequest('/v1/onboarding/tebra/activate', { session_id: autoSessionId }, OPS_HEADERS);
    assert.equal(response.status, 202);
    assert.equal(body.ok, true);
    assert.equal(body.approval.status, 'pending');
    replacementApprovalId = body.approval.approval_id;
    assert.notEqual(replacementApprovalId, autoApprovalId);
  }

  {
    const { response, body } = await jsonRequest('/v1/onboarding/tebra/manual-review/approve', {
      session_id: autoSessionId
    }, REVIEW_HEADERS);
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.approval.status, 'approved');
    assert.equal(body.approval.approval_id, replacementApprovalId);
  }

  {
    const { response, body } = await jsonRequest('/v1/onboarding/tebra/connection-test', {
      session_id: autoSessionId,
      adapter_mode: 'api_oauth'
    }, OPS_HEADERS);
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
  }

  {
    const { response, body } = await jsonRequest('/v1/onboarding/tebra/session', {
      practice_name: 'OAuth Blocked Clinic',
      contact_name: 'Blocked Flow',
      contact_email: 'blocked@example.com',
      environment: 'sandbox',
      connection_mode: 'direct-oauth-not-live'
    }, OPS_HEADERS);
    assert.equal(response.status, 201);
    const blockedSessionId = body.session.session_id;

    const preflight = await jsonRequest('/v1/onboarding/tebra/preflight', { session_id: blockedSessionId }, OPS_HEADERS);
    assert.equal(preflight.response.status, 422);
    assert.ok(preflight.body.blockers.some((item) => item.code === 'LIVE_TEBRA_OAUTH_DISABLED'));

    const activate = await jsonRequest('/v1/onboarding/tebra/activate', { session_id: blockedSessionId }, OPS_HEADERS);
    assert.equal(activate.response.status, 422);
    assert.equal(activate.body.error, 'TEBRA_PRECHECK_FAILED');
  }

  {
    const denialTaxonomy = await request('/v1/denials/taxonomy');
    assert.equal(denialTaxonomy.response.status, 200);
    assert.equal(denialTaxonomy.body.taxonomy.specialty, 'PMHNP');
    assert.ok(denialTaxonomy.body.taxonomy.buckets.some((item) => item.code === 'TEL-POS-MOD'));

    const denialScore = await jsonRequest('/v1/denials/score', {
      payer: 'BCBS',
      cpt: '99214',
      denial_reason: 'Telehealth modifier 95 missing and POS 10 inconsistent',
      claim_note: 'telehealth follow-up for PMHNP patient',
      artifact_names: ['claims_report_march.csv']
    }, OPS_HEADERS);
    assert.equal(denialScore.response.status, 200);
    assert.equal(denialScore.body.primary_match.denial_code, 'TEL-POS-MOD');
    assert.ok(denialScore.body.confidence > 0.6);

    const denialFeedback = await jsonRequest('/v1/denials/feedback', {
      claim_ref: 'claim-smoke-1',
      payer: 'BCBS',
      denial_reason: 'Telehealth modifier 95 missing and POS 10 inconsistent',
      reviewer_label: 'TEL-POS-MOD',
      actual_outcome: 'appeal-drafted',
      notes: 'Confirmed by reviewer.',
      reviewer_confirmed: true
    }, OPS_HEADERS);
    assert.equal(denialFeedback.response.status, 201);
    assert.equal(denialFeedback.body.feedback.learning_signal, 'confirmed');
    assert.ok(denialFeedback.body.learning_stats.totals.reviewer_confirmed_outcomes >= 1);

    const denialArtifact = await jsonRequest('/v1/denials/artifacts', {
      practice_name: 'Smoke Test Psychiatry',
      artifacts: [{
        name: 'tebra_denials_worklist.csv',
        format: 'csv',
        content_type: 'text/csv',
        content: [
          'claim_id,payer,patient_name,cpt,denial_reason,payer_message,claim_age_days,amount,modifier,pos',
          'clm-100,BCBS,Pat One,99214,Telehealth modifier 95 missing,POS 10 inconsistent,14,180,95,10',
          'clm-101,Aetna,Pat Two,90792,Authorization missing,prior authorization absent,33,240,,11',
          'clm-102,Medicaid,Pat Three,90833,Claim aged out,timely filing limit expired,121,325,,11'
        ].join('\n')
      }]
    }, OPS_HEADERS);
    assert.equal(denialArtifact.response.status, 201);
    assert.equal(denialArtifact.body.worklist.item_count, 3);
    assert.equal(denialArtifact.body.worklist.items[0].score.primary_match.denial_code, 'TIMELY-FILING');

    const denialLearning = await request('/v1/denials/learning');
    assert.equal(denialLearning.response.status, 200);
    assert.ok(denialLearning.body.learning.totals.ingested_artifacts >= 1);
    assert.ok(denialLearning.body.learning.totals.normalized_records >= 3);

    const denialWorklists = await request('/v1/denials/worklists');
    assert.equal(denialWorklists.response.status, 200);
    assert.ok(denialWorklists.body.worklists.length >= 1);

    const baseline = await jsonRequest('/v1/pilot/baseline', {
      practice_name: 'Smoke Test Psychiatry',
      monthly_denials_before: 18,
      denial_rate_before_percent: 14.2,
      average_days_to_first_touch_before: 9,
      average_appeal_turnaround_days_before: 14,
      average_dollars_at_risk_per_month: 6200,
      billing_staff_hourly_cost: 30,
      pilot_cost_usd: 1200
    }, OPS_HEADERS);
    assert.equal(baseline.response.status, 201);
    assert.equal(baseline.body.baseline.practice_name, 'Smoke Test Psychiatry');

    const pilotEvent = await jsonRequest('/v1/pilot/event', {
      practice_name: 'Smoke Test Psychiatry',
      denials_reviewed: 8,
      denials_overturned: 3,
      prevented_denials: 2,
      dollars_recovered: 1800,
      dollars_protected: 900,
      staff_minutes_saved: 150,
      appeal_turnaround_days_improved: 4,
      notes: 'Week 1 pilot review.'
    }, OPS_HEADERS);
    assert.equal(pilotEvent.response.status, 201);
    assert.equal(pilotEvent.body.event.practice_slug, 'smoke-test-psychiatry');

    const pilotReport = await jsonRequest('/v1/pilot/report', {
      practice_name: 'Smoke Test Psychiatry'
    }, OPS_HEADERS);
    assert.equal(pilotReport.response.status, 201);
    assert.equal(pilotReport.body.report.practice_slug, 'smoke-test-psychiatry');
    assert.ok(pilotReport.body.report.totals.total_estimated_impact > 0);

    const { response, body } = await request('/client/snapshot', {
      headers: { authorization: 'Bearer smoke-token' }
    });
    assert.equal(response.status, 200);
    assert.ok(body.automation.approvals.approved_count >= 2);
    assert.ok(body.automation.approvals.rejected_count >= 1);
    assert.ok(Array.isArray(body.onboarding.sessions));
    assert.ok(Array.isArray(body.onboarding.upload_batches));
    assert.ok(body.onboarding.upload_batches.length >= 1);
    assert.equal(body.truths.tebra_export_upload, true);
    assert.equal(body.truths.tebra_admin_assisted_sync, true);
    assert.equal(body.automation.denial_intelligence.specialty, 'PMHNP');
    assert.ok(body.automation.denial_intelligence.taxonomy_count >= 6);
    assert.ok(body.automation.denial_intelligence.worklist_count >= 1);
    assert.ok(body.automation.denial_intelligence.reviewer_confirmed_outcomes >= 1);
    assert.ok(body.automation.pilot_roi.baseline_count >= 1);
    assert.ok(body.ask_worklist.suggested_prompts.includes('What export uploads are ready for review?'));
    assert.ok(body.ask_worklist.suggested_prompts.includes('How do we prove ROI from this Claim Guard pilot?'));
  }

  {
    const { response, body } = await request('/v1/audit/events?limit=200');
    assert.equal(response.status, 200);
    const types = body.events.map((item) => item.type);
    assert.ok(types.includes('tebra.session.created'));
    assert.ok(types.includes('tebra.preflight.passed'));
    assert.ok(types.includes('tebra.activation.requested'));
    assert.ok(types.includes('tebra.approval.created'));
    assert.ok(types.includes('tebra.approval.rejected'));
    assert.ok(types.includes('tebra.approval.approved'));
    assert.ok(types.includes('tebra.connection_test.blocked'));
    assert.ok(types.includes('tebra.connection_test.passed'));
    assert.ok(types.includes('tebra.mapping_validation.passed'));
    assert.ok(types.includes('tebra.automation.intake_prepared'));
    assert.ok(types.includes('tebra.export_upload.received'));
    assert.ok(body.events.some((item) => item.actor.actor_id === 'smoke-reviewer'));
  }

  strictServer = startOperationalServer({
    port: 0,
    clientToken: 'strict-client-token',
    operationalToken: 'strict-ops-token',
    security: {
      require_forwarded_tls: true,
      enforce_operational_auth: true,
      require_actor_headers: true
    },
    authConfig: {
      signing_secret: 'strict-signing-secret',
      client_login_key: 'strict-client-key',
      reviewer_login_key: 'strict-reviewer-key',
      admin_login_key: 'strict-admin-key',
      token_ttl_seconds: 3600,
      allow_legacy_static_tokens: false
    },
    healthConfig: {
      minimal_public_response: true
    }
  });
  await new Promise((resolve) => strictServer.once('listening', resolve));

  const strictAddress = strictServer.address();
  const strictPort = typeof strictAddress === 'object' && strictAddress ? strictAddress.port : null;
  const strictBase = `http://127.0.0.1:${strictPort}`;

  async function strictRequest(pathname, options = {}) {
    const response = await fetch(`${strictBase}${pathname}`, options);
    let body = null;
    const text = await response.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { response, body };
  }

  {
    const { response, body } = await strictRequest('/client/session');
    assert.equal(response.status, 403);
    assert.equal(body.error, 'OPERATIONAL_API_TLS_REQUIRED');
  }

  {
    const { response, body } = await strictRequest('/client/session', {
      headers: { 'x-forwarded-proto': 'https' }
    });
    assert.equal(response.status, 401);
    assert.equal(body.error, 'CLIENT_PORTAL_AUTH_REQUIRED');
  }

  {
    const { response, body } = await strictRequest('/v1/public/tebra/intake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ packet: onboardingPacket, website: '' })
    });
    assert.equal(response.status, 403);
    assert.equal(body.error, 'OPERATIONAL_API_TLS_REQUIRED');
  }

  {
    const { response, body } = await strictRequest('/v1/public/tebra/intake', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-proto': 'https'
      },
      body: JSON.stringify({ packet: onboardingPacket, website: '' })
    });
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.intake.practice_name, onboardingPacket.practice_name);
  }

  {
    const { response, body } = await strictRequest('/v1/onboarding/tebra/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-proto': 'https'
      },
      body: JSON.stringify(onboardingPacket)
    });
    assert.equal(response.status, 401);
    assert.equal(body.error, 'OPERATIONAL_API_AUTH_REQUIRED');
  }

  let strictClientToken;
  {
    const { response, body } = await strictRequest('/v1/auth/client/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-proto': 'https'
      },
      body: JSON.stringify({ access_key: 'strict-client-key', actor_id: 'strict-client-user' })
    });
    assert.equal(response.status, 200);
    assert.equal(body.role, 'client');
    strictClientToken = body.token;
    assert.ok(strictClientToken);
  }

  {
    const { response, body } = await strictRequest('/client/session', {
      headers: {
        'x-forwarded-proto': 'https',
        authorization: `Bearer ${strictClientToken}`
      }
    });
    assert.equal(response.status, 200);
    assert.equal(body.user.role, 'client');
  }

  {
    const { response, body } = await strictRequest('/v1/onboarding/tebra/intake/automate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-proto': 'https',
        authorization: `Bearer ${strictClientToken}`
      },
      body: JSON.stringify({ packet: onboardingPacket })
    });
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.session.practice.practice_name, onboardingPacket.practice_name);
  }

  {
    const { response, body } = await strictRequest('/v1/onboarding/tebra/session/strict-probe', {
      headers: {
        'x-forwarded-proto': 'https',
        authorization: `Bearer ${strictClientToken}`
      }
    });
    assert.equal(response.status, 403);
    assert.equal(body.error, 'OPERATIONAL_API_FORBIDDEN');
  }

  let strictReviewerToken;
  {
    const { response, body } = await strictRequest('/v1/auth/ops/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-proto': 'https'
      },
      body: JSON.stringify({ access_key: 'strict-reviewer-key', actor_id: 'strict-reviewer' })
    });
    assert.equal(response.status, 200);
    assert.equal(body.role, 'reviewer');
    strictReviewerToken = body.token;
    assert.ok(strictReviewerToken);
  }

  {
    const { response, body } = await strictRequest('/v1/onboarding/tebra/preflight', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-proto': 'https',
        authorization: `Bearer ${strictReviewerToken}`
      },
      body: JSON.stringify({ session_id: 'strict-review-missing-actor' })
    });
    assert.equal(response.status, 400);
    assert.equal(body.error, 'OPERATIONAL_API_ACTOR_REQUIRED');
  }

  {
    const { response, body } = await strictRequest('/v1/onboarding/tebra/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-proto': 'https',
        authorization: `Bearer ${strictReviewerToken}`,
        'x-actor-id': 'strict-reviewer',
        'x-role': 'reviewer'
      },
      body: JSON.stringify(onboardingPacket)
    });
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
  }

  {
    const { response, body } = await strictRequest('/v1/audit/events', {
      headers: {
        'x-forwarded-proto': 'https',
        authorization: `Bearer ${strictReviewerToken}`,
        'x-actor-id': 'strict-reviewer',
        'x-role': 'reviewer'
      }
    });
    assert.equal(response.status, 403);
    assert.equal(body.error, 'OPERATIONAL_API_FORBIDDEN');
  }

  let strictAdminToken;
  {
    const { response, body } = await strictRequest('/v1/auth/ops/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-proto': 'https'
      },
      body: JSON.stringify({ access_key: 'strict-admin-key', actor_id: 'strict-admin' })
    });
    assert.equal(response.status, 200);
    assert.equal(body.role, 'admin');
    strictAdminToken = body.token;
    assert.ok(strictAdminToken);
  }

  {
    const { response, body } = await strictRequest('/v1/audit/events', {
      headers: {
        'x-forwarded-proto': 'https',
        authorization: `Bearer ${strictAdminToken}`,
        'x-actor-id': 'strict-admin',
        'x-role': 'admin'
      }
    });
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.events));
  }

  {
    const { response, body } = await strictRequest('/v1/system/status', {
      headers: {
        'x-forwarded-proto': 'https',
        authorization: `Bearer ${strictAdminToken}`,
        'x-actor-id': 'strict-admin',
        'x-role': 'admin'
      }
    });
    assert.equal(response.status, 200);
    assert.equal(body.health_config.minimal_public_response, true);
  }

  console.log('Smoke tests passed.');
} finally {
  if (strictServer) {
    await new Promise((resolve, reject) => strictServer.close((error) => error ? reject(error) : resolve()));
  }
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
