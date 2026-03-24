import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { AUTH_CONFIG, AUTOMATION_POLICY, CLIENT_PORTAL_AVAILABLE_ROUTES, HEALTH_CONFIG, OPERATIONAL_SECURITY, PUBLIC_DIR, TRUTHS } from '../config.mjs';
import { getApproval, listApprovals } from '../domain/approvalQueue.mjs';
import { loadSnapshotForClient } from '../domain/clientPortal.mjs';
import { submitPublicIntake } from '../domain/publicIntake.mjs';
import {
  getDenialLearningStats,
  getDenialTaxonomy,
  ingestDenialArtifacts,
  listDenialArtifacts,
  listDenialFeedback,
  listDenialWorklists,
  recordDenialFeedback,
  scoreDenial
} from '../domain/denialWorkbench.mjs';
import { generatePilotReport, listPilotBaselines, recordPilotEvent, upsertPilotBaseline } from '../domain/pilotMetrics.mjs';
import {
  activateSession,
  approveManualReview,
  automateIntake,
  connectionTest,
  createOnboardingSession,
  createUploadBatch,
  getProviderProfile,
  getSession,
  getUploadBatch,
  listProviderProfiles,
  listSessions,
  listUploadBatches,
  mappingValidate,
  rejectManualReview,
  sessionPreflight
} from '../domain/tebraOnboarding.mjs';
import { listAuditEvents } from '../lib/audit.mjs';
import { hasRole, hasScopes, issueAccessToken, verifyAccessToken } from '../lib/authTokens.mjs';

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization,content-type,x-actor-id,x-role',
    'Access-Control-Allow-Methods': 'GET,POST,HEAD,OPTIONS',
    'Access-Control-Max-Age': '86400',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'x-request-id': `req_${crypto.randomUUID()}`
  });
  res.end(body);
}

function authError(res) {
  return json(res, 401, {
    error: 'CLIENT_PORTAL_AUTH_REQUIRED',
    message: 'Bearer token is required for client portal routes'
  });
}

function invalidToken(res) {
  return json(res, 401, {
    error: 'CLIENT_PORTAL_AUTH_INVALID',
    message: 'Client access token format is invalid'
  });
}

function operationalTlsError(res) {
  return json(res, 403, {
    error: 'OPERATIONAL_API_TLS_REQUIRED',
    message: 'Operational API requires TLS. Terminate TLS at the edge and pass x-forwarded-proto=https.'
  });
}

function operationalAuthRequired(res) {
  return json(res, 401, {
    error: 'OPERATIONAL_API_AUTH_REQUIRED',
    message: 'Bearer token is required for operational API routes'
  });
}

function operationalAuthInvalid(res) {
  return json(res, 401, {
    error: 'OPERATIONAL_API_AUTH_INVALID',
    message: 'Operational API token is invalid'
  });
}

function operationalActorRequired(res) {
  return json(res, 400, {
    error: 'OPERATIONAL_API_ACTOR_REQUIRED',
    message: 'Operational API requires x-actor-id and x-role headers when actor enforcement is enabled.'
  });
}

function operationalForbidden(res) {
  return json(res, 403, {
    error: 'OPERATIONAL_API_FORBIDDEN',
    message: 'Authenticated token is not permitted for this operational route.'
  });
}

function bearerToken(req) {
  const raw = req.headers.authorization || '';
  if (!raw.startsWith('Bearer ')) return null;
  const token = raw.slice('Bearer '.length).trim();
  return token || null;
}

function requestActor(req) {
  return {
    actor_id: String(req.headers['x-actor-id'] || 'local-dev').trim() || 'local-dev',
    role: String(req.headers['x-role'] || 'system').trim() || 'system'
  };
}

function hasForwardedTls(req) {
  if (req.socket?.encrypted) return true;
  const raw = String(req.headers['x-forwarded-proto'] || '');
  return raw.split(',').map((item) => item.trim().toLowerCase()).includes('https');
}

function requireForwardedTls(req, res, security) {
  if (!security.require_forwarded_tls) return true;
  if (hasForwardedTls(req)) return true;
  operationalTlsError(res);
  return false;
}

function validateActorHeaders(req, res, security) {
  if (!security.require_actor_headers) return true;
  const actorId = String(req.headers['x-actor-id'] || '').trim();
  const role = String(req.headers['x-role'] || '').trim();
  if (actorId && role) return true;
  operationalActorRequired(res);
  return false;
}

function isClientPortalRoute(pathname) {
  return pathname === '/client/session' || pathname === '/client/snapshot';
}

function isV1Route(pathname) {
  return pathname.startsWith('/v1/');
}

function routePolicy(pathname) {
  if (pathname === '/v1/auth/client/login') {
    return { publicAuthRoute: true, loginScope: 'client' };
  }
  if (pathname === '/v1/auth/ops/login') {
    return { publicAuthRoute: true, loginScope: 'ops' };
  }
  if (pathname === '/v1/public/tebra/intake') {
    return { publicAuthRoute: true };
  }
  if (pathname === '/v1/audit/events' || pathname === '/v1/system/status') {
    return { requiredScopes: ['audit'], allowedRoles: ['admin'], requireActor: true };
  }
  if (
    pathname === '/v1/onboarding/tebra/session' ||
    pathname === '/v1/onboarding/tebra/intake/automate' ||
    pathname === '/v1/onboarding/tebra/export-upload'
  ) {
    return { requiredScopes: ['client'], allowedRoles: ['client', 'reviewer', 'admin'], requireActor: false };
  }
  if (
    pathname === '/v1/approvals' ||
    pathname.startsWith('/v1/approvals/') ||
    pathname === '/v1/onboarding/tebra/sessions' ||
    pathname === '/v1/onboarding/tebra/provider-profiles' ||
    pathname === '/v1/onboarding/tebra/upload-batches' ||
    pathname.startsWith('/v1/onboarding/tebra/provider-profile/') ||
    pathname.startsWith('/v1/onboarding/tebra/upload-batch/') ||
    pathname === '/v1/onboarding/tebra/manual-review/approve' ||
    pathname === '/v1/onboarding/tebra/manual-review/reject' ||
    pathname === '/v1/onboarding/tebra/activate' ||
    pathname === '/v1/onboarding/tebra/connection-test' ||
    pathname === '/v1/onboarding/tebra/mapping-validate' ||
    pathname === '/v1/onboarding/tebra/preflight' ||
    pathname === '/v1/denials/taxonomy' ||
    pathname === '/v1/denials/score' ||
    pathname === '/v1/denials/feedback' ||
    pathname === '/v1/denials/learning' ||
    pathname === '/v1/denials/artifacts' ||
    pathname === '/v1/denials/worklists' ||
    pathname === '/v1/pilot/baseline' ||
    pathname === '/v1/pilot/event' ||
    pathname === '/v1/pilot/report' ||
    pathname.startsWith('/v1/onboarding/tebra/session/')
  ) {
    return { requiredScopes: ['ops'], allowedRoles: ['reviewer', 'admin'], requireActor: true };
  }
  return null;
}

function requireClientAuth(req, res, clientToken, authConfig) {
  const token = bearerToken(req);
  if (!token) {
    authError(res);
    return null;
  }

  if (authConfig.allow_legacy_static_tokens && token === clientToken) {
    return {
      ok: true,
      payload: {
        sub: 'legacy-client-token',
        role: 'client',
        scopes: ['client'],
        legacy: true
      }
    };
  }

  const verified = verifyAccessToken(token, authConfig);
  if (!verified.ok || !hasScopes(verified.payload, ['client'])) {
    invalidToken(res);
    return null;
  }

  return verified;
}

function requireOperationalAccess(req, res, policy, operationalToken, security, authConfig) {
  if (!policy || policy.publicAuthRoute) return { ok: true, payload: null };
  if (!security.enforce_operational_auth) return { ok: true, payload: null };

  const token = bearerToken(req);
  if (!token) {
    operationalAuthRequired(res);
    return null;
  }

  let verified = null;
  if (authConfig.allow_legacy_static_tokens && token === operationalToken) {
    verified = {
      ok: true,
      payload: {
        sub: 'legacy-operational-token',
        role: 'admin',
        scopes: ['client', 'ops', 'audit'],
        legacy: true
      }
    };
  } else {
    verified = verifyAccessToken(token, authConfig);
    if (!verified.ok) {
      operationalAuthInvalid(res);
      return null;
    }
  }

  if (!hasScopes(verified.payload, policy.requiredScopes || []) || !hasRole(verified.payload, policy.allowedRoles || [])) {
    operationalForbidden(res);
    return null;
  }

  if (policy.requireActor && !validateActorHeaders(req, res, security)) {
    return null;
  }

  return verified;
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.xml': return 'application/xml; charset=utf-8';
    case '.txt': return 'text/plain; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

function safeJoin(root, requestPath) {
  const target = path.normalize(path.join(root, requestPath));
  return target.startsWith(root) ? target : null;
}

function sendFile(res, filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mimeType(filePath),
      'Content-Length': stat.size,
      'Cache-Control': filePath.endsWith('.html') ? 'no-store' : 'public, max-age=300'
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1024 * 1024) {
      throw new Error('REQUEST_BODY_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('INVALID_JSON');
  }
}

function sendResult(res, result) {
  if (result && typeof result.status === 'number') {
    return json(res, result.status, result);
  }
  return json(res, 200, result);
}

function parseLimit(value, fallback = 50, max = 500) {
  const parsed = Number.parseInt(String(value || fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function createServer({
  clientToken,
  operationalToken = clientToken,
  security = OPERATIONAL_SECURITY,
  authConfig = AUTH_CONFIG,
  healthConfig = HEALTH_CONFIG
}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const actor = requestActor(req);
    const policy = routePolicy(url.pathname);

    if (req.method === 'OPTIONS') {
      return json(res, 204, {});
    }

    if ((isClientPortalRoute(url.pathname) || isV1Route(url.pathname)) && !requireForwardedTls(req, res, security)) {
      return;
    }

    if (isV1Route(url.pathname)) {
      const authResult = requireOperationalAccess(req, res, policy, operationalToken, security, authConfig);
      if (authResult == null) return;
    }

    if (url.pathname === '/health') {
      if (healthConfig.minimal_public_response) {
        return json(res, 200, { ok: true });
      }
      return json(res, 200, {
        ok: true,
        mode: 'recovered-dev',
        source: 'pmhnp-denial-copilot-recovered',
        truths: TRUTHS,
        automation_policy: AUTOMATION_POLICY,
        operational_security: security,
        counts: {
          onboarding_sessions: listSessions().length,
          provider_profiles: listProviderProfiles().length,
          upload_batches: listUploadBatches().length,
          approvals: listApprovals().length
        },
        generated_at: new Date().toISOString()
      });
    }

    if (url.pathname === '/client/snapshot') {
      if (!requireClientAuth(req, res, clientToken, authConfig)) return;
      return json(res, 200, loadSnapshotForClient());
    }

    if (url.pathname === '/client/session') {
      const clientAuth = requireClientAuth(req, res, clientToken, authConfig);
      if (!clientAuth) return;
      return json(res, 200, {
        ok: true,
        mode: 'recovered-dev',
        user: {
          role: clientAuth.payload.role,
          auth: clientAuth.payload.legacy ? 'legacy-bearer-token' : 'signed-bearer-token',
          actor_id: clientAuth.payload.sub
        },
        truths: TRUTHS,
        automation_policy: AUTOMATION_POLICY,
        operational_security: security,
        available_routes: CLIENT_PORTAL_AVAILABLE_ROUTES
      });
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/client/login') {
      try {
        const body = await readJsonBody(req);
        const result = issueAccessToken({
          accessKey: body.access_key,
          actorId: body.actor_id || body.email || 'client-user',
          requestedScope: 'client',
          authConfig
        });
        return sendResult(res, result);
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid client login payload.' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/ops/login') {
      try {
        const body = await readJsonBody(req);
        const result = issueAccessToken({
          accessKey: body.access_key,
          actorId: body.actor_id || 'reviewer-user',
          requestedScope: 'ops',
          authConfig
        });
        return sendResult(res, result);
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid operational login payload.' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/public/tebra/intake') {
      try {
        const body = await readJsonBody(req);
        const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
          .split(',')[0]
          .trim();
        return sendResult(res, submitPublicIntake(body, {
          ip,
          website: body.website || body.company_website || body.url || '',
          artifacts: Array.isArray(body.artifacts) ? body.artifacts : []
        }));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid public intake payload.' });
      }
    }

    if (req.method === 'GET' && url.pathname === '/v1/system/status') {
      return json(res, 200, {
        ok: true,
        mode: 'recovered-admin-status',
        source: 'pmhnp-denial-copilot-recovered',
        truths: TRUTHS,
        automation_policy: AUTOMATION_POLICY,
        operational_security: security,
        health_config: healthConfig,
        counts: {
          onboarding_sessions: listSessions().length,
          provider_profiles: listProviderProfiles().length,
          upload_batches: listUploadBatches().length,
          approvals: listApprovals().length
        },
        generated_at: new Date().toISOString()
      });
    }

    if (req.method === 'GET' && url.pathname === '/v1/onboarding/tebra/sessions') {
      return json(res, 200, { ok: true, sessions: listSessions() });
    }

    if (req.method === 'GET' && url.pathname === '/v1/onboarding/tebra/provider-profiles') {
      return json(res, 200, { ok: true, provider_profiles: listProviderProfiles() });
    }

    if (req.method === 'GET' && url.pathname === '/v1/onboarding/tebra/upload-batches') {
      return json(res, 200, { ok: true, upload_batches: listUploadBatches() });
    }

    if (req.method === 'POST' && url.pathname === '/v1/onboarding/tebra/session') {
      try {
        const body = await readJsonBody(req);
        return sendResult(res, { ok: true, status: 201, truths: TRUTHS, session: createOnboardingSession(body, actor) });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid onboarding session payload.' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/onboarding/tebra/intake/automate') {
      try {
        const body = await readJsonBody(req);
        return sendResult(res, automateIntake(body.packet || body, actor));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid automated intake payload.' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/onboarding/tebra/export-upload') {
      try {
        const body = await readJsonBody(req);
        return sendResult(res, createUploadBatch(body, actor));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid export-upload payload.' });
      }
    }

    const sessionMatch = url.pathname.match(/^\/v1\/onboarding\/tebra\/session\/([^/]+)$/);
    if (req.method === 'GET' && sessionMatch) {
      const session = getSession(sessionMatch[1]);
      if (!session) {
        return json(res, 404, { ok: false, error: 'TEBRA_SESSION_NOT_FOUND', message: 'Session not found.' });
      }
      return json(res, 200, { ok: true, session, preflight: sessionPreflight(session, actor) });
    }

    const profileMatch = url.pathname.match(/^\/v1\/onboarding\/tebra\/provider-profile\/([^/]+)$/);
    if (req.method === 'GET' && profileMatch) {
      const profile = getProviderProfile(profileMatch[1]);
      if (!profile) {
        return json(res, 404, { ok: false, error: 'TEBRA_PROVIDER_PROFILE_NOT_FOUND', message: 'Provider profile not found.' });
      }
      return json(res, 200, { ok: true, provider_profile: profile });
    }

    const uploadBatchMatch = url.pathname.match(/^\/v1\/onboarding\/tebra\/upload-batch\/([^/]+)$/);
    if (req.method === 'GET' && uploadBatchMatch) {
      const batch = getUploadBatch(uploadBatchMatch[1]);
      if (!batch) {
        return json(res, 404, { ok: false, error: 'TEBRA_UPLOAD_BATCH_NOT_FOUND', message: 'Upload batch not found.' });
      }
      return json(res, 200, { ok: true, upload_batch: batch });
    }

    if (req.method === 'POST' && url.pathname === '/v1/onboarding/tebra/preflight') {
      try {
        const body = await readJsonBody(req);
        return sendResult(res, sessionPreflight(body.session_id, actor));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid preflight payload.' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/onboarding/tebra/activate') {
      try {
        const body = await readJsonBody(req);
        return sendResult(res, activateSession(body.session_id, actor));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid activate payload.' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/onboarding/tebra/manual-review/approve') {
      try {
        const body = await readJsonBody(req);
        return sendResult(res, approveManualReview(body.session_id, actor));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid manual review payload.' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/onboarding/tebra/manual-review/reject') {
      try {
        const body = await readJsonBody(req);
        return sendResult(res, rejectManualReview(body.session_id, actor, body.reason));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid manual review reject payload.' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/onboarding/tebra/connection-test') {
      try {
        const body = await readJsonBody(req);
        return sendResult(res, connectionTest(body, actor));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid connection-test payload.' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/onboarding/tebra/mapping-validate') {
      try {
        const body = await readJsonBody(req);
        return sendResult(res, mappingValidate(body, actor));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid mapping-validate payload.' });
      }
    }

    if (req.method === 'GET' && url.pathname === '/v1/approvals') {
      return json(res, 200, {
        ok: true,
        approvals: listApprovals({
          status: url.searchParams.get('status') || undefined,
          session_id: url.searchParams.get('session_id') || undefined,
          subject_id: url.searchParams.get('subject_id') || undefined
        })
      });
    }

    const approvalMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)$/);
    if (req.method === 'GET' && approvalMatch) {
      const approval = getApproval(approvalMatch[1]);
      if (!approval) {
        return json(res, 404, { ok: false, error: 'APPROVAL_NOT_FOUND', message: 'Approval not found.' });
      }
      return json(res, 200, { ok: true, approval });
    }

    const approvalApproveMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)\/approve$/);
    if (req.method === 'POST' && approvalApproveMatch) {
      const approval = getApproval(approvalApproveMatch[1]);
      if (!approval) {
        return json(res, 404, { ok: false, error: 'APPROVAL_NOT_FOUND', message: 'Approval not found.' });
      }
      return sendResult(res, approveManualReview(approval.session_id, actor));
    }

    const approvalRejectMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)\/reject$/);
    if (req.method === 'POST' && approvalRejectMatch) {
      const approval = getApproval(approvalRejectMatch[1]);
      if (!approval) {
        return json(res, 404, { ok: false, error: 'APPROVAL_NOT_FOUND', message: 'Approval not found.' });
      }
      try {
        const body = await readJsonBody(req);
        return sendResult(res, rejectManualReview(approval.session_id, actor, body.reason));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid approval rejection payload.' });
      }
    }

    if (req.method === 'GET' && url.pathname === '/v1/audit/events') {
      return json(res, 200, {
        ok: true,
        events: listAuditEvents({ limit: parseLimit(url.searchParams.get('limit'), 100, 1000) })
      });
    }

    if (req.method === 'GET' && url.pathname === '/v1/denials/taxonomy') {
      return json(res, 200, { ok: true, taxonomy: getDenialTaxonomy() });
    }

    if (req.method === 'POST' && url.pathname === '/v1/denials/score') {
      try {
        const body = await readJsonBody(req);
        return sendResult(res, scoreDenial(body, actor));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid denial scoring payload.' });
      }
    }

    if (req.method === 'GET' && url.pathname === '/v1/denials/feedback') {
      return json(res, 200, { ok: true, feedback: listDenialFeedback() });
    }

    if (req.method === 'POST' && url.pathname === '/v1/denials/feedback') {
      try {
        const body = await readJsonBody(req);
        return sendResult(res, recordDenialFeedback(body, actor));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid denial feedback payload.' });
      }
    }

    if (req.method === 'GET' && url.pathname === '/v1/denials/learning') {
      return json(res, 200, { ok: true, learning: getDenialLearningStats() });
    }

    if (req.method === 'GET' && url.pathname === '/v1/denials/artifacts') {
      return json(res, 200, { ok: true, artifacts: listDenialArtifacts() });
    }

    if (req.method === 'POST' && url.pathname === '/v1/denials/artifacts') {
      try {
        const body = await readJsonBody(req);
        return sendResult(res, ingestDenialArtifacts(body, actor));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid denial artifact payload.' });
      }
    }

    if (req.method === 'GET' && url.pathname === '/v1/denials/worklists') {
      return json(res, 200, { ok: true, worklists: listDenialWorklists() });
    }

    if (req.method === 'GET' && url.pathname === '/v1/pilot/baseline') {
      return json(res, 200, { ok: true, baselines: listPilotBaselines() });
    }

    if (req.method === 'POST' && url.pathname === '/v1/pilot/baseline') {
      try {
        const body = await readJsonBody(req);
        return sendResult(res, upsertPilotBaseline(body, actor));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid pilot baseline payload.' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/pilot/event') {
      try {
        const body = await readJsonBody(req);
        return sendResult(res, recordPilotEvent(body, actor));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid pilot event payload.' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/v1/pilot/report') {
      try {
        const body = await readJsonBody(req);
        return sendResult(res, generatePilotReport(body, actor));
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message, message: 'Invalid pilot report payload.' });
      }
    }

    let requestPath = url.pathname;
    if (requestPath === '/') requestPath = '/index.html';
    if (requestPath.endsWith('/')) requestPath += 'index.html';

    const target = safeJoin(PUBLIC_DIR, requestPath);
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }

    sendFile(res, target);
  });
}
