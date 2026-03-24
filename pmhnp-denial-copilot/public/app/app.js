const CLIENT_TOKEN_KEY = "pmhnp_client_access_token";
const CLIENT_API_BASE_KEY = "pmhnp_client_api_base";
const OPS_TOKEN_KEY = "pmhnp_ops_access_token";
const OPS_API_BASE_KEY = "pmhnp_ops_api_base";
const OPS_ACTOR_ID_KEY = "pmhnp_ops_actor_id";
const OPS_ACTOR_ROLE_KEY = "pmhnp_ops_actor_role";

const FALLBACK_SNAPSHOT = {
  generated_at: new Date().toISOString(),
  source: { type: "app-shell", run_id: "secure_access_required", finding_count: 0 },
  truths: {
    live_tebra_oauth: false,
    live_client_auth_provisioning: false,
    claim_auto_submission: false,
    pilot_manual_connection_request: true,
    local_onboarding_packet_builder: true,
    tebra_export_upload: true,
    tebra_admin_assisted_sync: true
  },
  dashboard: {
    today_priorities: [],
    claims_at_risk: [],
    needs_review: []
  },
  automation: {
    approvals: {
      pending_count: 0,
      approved_count: 0,
      rejected_count: 0,
      pending_items: []
    },
    pilot_roi: {
      baseline_count: 0,
      tracked_practices: []
    },
    denial_intelligence: {
      taxonomy_count: 0,
      taxonomy_preview: []
    }
  },
  onboarding: { sessions: [] },
  ask_worklist: {
    suggested_prompts: [
      "What will appear here after secure access is connected?",
      "How do we prove ROI from this Claim Guard pilot?",
      "Should this practice use upload-first or live sync first?",
      "What export uploads are ready for review?"
    ],
    top_finding_preview: {
      what_happened: "No live claim-risk or recovery worklist is loaded in this public shell.",
      why_it_matters: "This page is intentionally empty until secure access is connected so it does not show preview claim data.",
      recommended_next_steps: [
        "Connect secure access to load live worklists",
        "Or start with upload-first Tebra intake",
        "Keep claim-facing actions human-reviewed"
      ],
      confidence: "high",
      main_uncertainty: "Live worklist content depends on authenticated practice data, not public preview data."
    }
  }
};

function severityPillClass(severity) {
  return `severity-pill severity-${String(severity || "low").toLowerCase()}`;
}

function toLocalDate(value) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function getSavedAccessConfig() {
  return {
    token: (window.localStorage.getItem(CLIENT_TOKEN_KEY) || "").trim(),
    apiBase: (window.localStorage.getItem(CLIENT_API_BASE_KEY) || "").trim()
  };
}

function saveAccessConfig(config) {
  if (config.token && config.token.trim()) {
    window.localStorage.setItem(CLIENT_TOKEN_KEY, config.token.trim());
  } else {
    window.localStorage.removeItem(CLIENT_TOKEN_KEY);
  }

  if (config.apiBase && config.apiBase.trim()) {
    window.localStorage.setItem(CLIENT_API_BASE_KEY, config.apiBase.trim());
  } else {
    window.localStorage.removeItem(CLIENT_API_BASE_KEY);
  }
}

function getSavedOpsConfig() {
  return {
    token: (window.localStorage.getItem(OPS_TOKEN_KEY) || "").trim(),
    apiBase: (window.localStorage.getItem(OPS_API_BASE_KEY) || "").trim(),
    actorId: (window.localStorage.getItem(OPS_ACTOR_ID_KEY) || "").trim(),
    actorRole: (window.localStorage.getItem(OPS_ACTOR_ROLE_KEY) || "").trim()
  };
}

function saveOpsConfig(config) {
  if (config.token && config.token.trim()) {
    window.localStorage.setItem(OPS_TOKEN_KEY, config.token.trim());
  } else {
    window.localStorage.removeItem(OPS_TOKEN_KEY);
  }

  if (config.apiBase && config.apiBase.trim()) {
    window.localStorage.setItem(OPS_API_BASE_KEY, config.apiBase.trim());
  } else {
    window.localStorage.removeItem(OPS_API_BASE_KEY);
  }

  if (config.actorId && config.actorId.trim()) {
    window.localStorage.setItem(OPS_ACTOR_ID_KEY, config.actorId.trim());
  } else {
    window.localStorage.removeItem(OPS_ACTOR_ID_KEY);
  }

  if (config.actorRole && config.actorRole.trim()) {
    window.localStorage.setItem(OPS_ACTOR_ROLE_KEY, config.actorRole.trim());
  } else {
    window.localStorage.removeItem(OPS_ACTOR_ROLE_KEY);
  }
}

function opsReady() {
  const { token, actorId, actorRole } = getSavedOpsConfig();
  return Boolean(token && actorId && actorRole);
}

function renderAccessStatus(message) {
  const status = document.getElementById("clientAccessStatus");
  status.textContent = message;
}

function renderOpsStatus(message) {
  const status = document.getElementById("opsAccessStatus");
  status.textContent = message;
}

function renderApprovalOpsStatus(message) {
  const status = document.getElementById("approvalOpsStatus");
  status.textContent = message;
}

function wireAccessForm() {
  const form = document.getElementById("clientAccessForm");
  const tokenInput = document.getElementById("clientAccessToken");
  const accessKeyInput = document.getElementById("clientAccessKey");
  const apiBaseInput = document.getElementById("clientApiBase");
  const exchangeBtn = document.getElementById("exchangeClientKeyBtn");
  const clearBtn = document.getElementById("clearClientAccessBtn");

  const current = getSavedAccessConfig();
  tokenInput.value = current.token;
  apiBaseInput.value = current.apiBase;

  if (current.token) {
    renderAccessStatus("Secure token saved. This app will try live dashboard mode first.");
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const token = tokenInput.value.trim();
    const apiBase = apiBaseInput.value.trim();

    saveAccessConfig({ token, apiBase });
    renderAccessStatus(token ? "Secure access saved. Reloading live dashboard..." : "No secure token saved. Connect secure access to load live Claim Guard data.");
    window.location.reload();
  });

  exchangeBtn.addEventListener("click", async () => {
    const accessKey = accessKeyInput.value.trim();
    const apiBase = apiBaseInput.value.trim();
    if (!accessKey) {
      renderAccessStatus("Enter a client access key first.");
      return;
    }

    try {
      exchangeBtn.disabled = true;
      renderAccessStatus("Exchanging client access key for signed token...");
      const payload = await exchangeClientAccessKey(accessKey, apiBase);
      saveAccessConfig({ token: payload.token, apiBase });
      tokenInput.value = payload.token;
      accessKeyInput.value = "";
      renderAccessStatus(`Client token issued (${payload.role}) until ${toLocalDate(payload.expires_at)}. Reloading...`);
      window.location.reload();
    } catch (error) {
      exchangeBtn.disabled = false;
      renderAccessStatus(error.message || "Client access key exchange failed.");
    }
  });

  clearBtn.addEventListener("click", () => {
    saveAccessConfig({ token: "", apiBase: "" });
    tokenInput.value = "";
    accessKeyInput.value = "";
    apiBaseInput.value = "";
    renderAccessStatus("Secure token cleared. Public shell only until secure access is connected.");
    window.location.reload();
  });
}

function wireOpsForm() {
  const form = document.getElementById("opsAccessForm");
  const tokenInput = document.getElementById("opsAccessToken");
  const accessKeyInput = document.getElementById("opsAccessKey");
  const apiBaseInput = document.getElementById("opsApiBase");
  const actorIdInput = document.getElementById("opsActorId");
  const actorRoleInput = document.getElementById("opsActorRole");
  const exchangeBtn = document.getElementById("exchangeOpsKeyBtn");
  const clearBtn = document.getElementById("clearOpsAccessBtn");

  const current = getSavedOpsConfig();
  tokenInput.value = current.token;
  apiBaseInput.value = current.apiBase;
  actorIdInput.value = current.actorId;
  actorRoleInput.value = current.actorRole || "reviewer";

  if (current.token && current.actorId && current.actorRole) {
    renderOpsStatus("Reviewer access saved. Approval actions are enabled.");
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const token = tokenInput.value.trim();
    const apiBase = apiBaseInput.value.trim();
    const actorId = actorIdInput.value.trim();
    const actorRole = actorRoleInput.value.trim() || "reviewer";

    saveOpsConfig({ token, apiBase, actorId, actorRole });
    renderOpsStatus(token && actorId && actorRole
      ? "Reviewer access saved. Reloading approval operations..."
      : "Reviewer access incomplete. Approval operations stay read-only.");
    window.location.reload();
  });

  exchangeBtn.addEventListener("click", async () => {
    const accessKey = accessKeyInput.value.trim();
    const apiBase = apiBaseInput.value.trim();
    const actorId = actorIdInput.value.trim();
    const actorRole = actorRoleInput.value.trim() || "reviewer";

    if (!accessKey || !actorId) {
      renderOpsStatus("Enter reviewer/admin access key and actor ID first.");
      return;
    }

    try {
      exchangeBtn.disabled = true;
      renderOpsStatus("Exchanging reviewer access key for signed token...");
      const payload = await exchangeOpsAccessKey(accessKey, actorId, apiBase);
      saveOpsConfig({ token: payload.token, apiBase, actorId, actorRole });
      tokenInput.value = payload.token;
      accessKeyInput.value = "";
      renderOpsStatus(`Reviewer token issued (${payload.role}) until ${toLocalDate(payload.expires_at)}. Reloading...`);
      window.location.reload();
    } catch (error) {
      exchangeBtn.disabled = false;
      renderOpsStatus(error.message || "Reviewer access key exchange failed.");
    }
  });

  clearBtn.addEventListener("click", () => {
    saveOpsConfig({ token: "", apiBase: "", actorId: "", actorRole: "" });
    tokenInput.value = "";
    accessKeyInput.value = "";
    apiBaseInput.value = "";
    actorIdInput.value = "";
    actorRoleInput.value = "reviewer";
    renderOpsStatus("Reviewer access cleared. Approval operations stay read-only.");
    window.location.reload();
  });
}

function renderPriorities(snapshot) {
  const list = document.getElementById("prioritiesList");
  list.innerHTML = "";

  if (!snapshot.dashboard.today_priorities.length) {
    list.innerHTML = `<li class="stack-item">No live priorities loaded. Connect secure access to view claim-risk and recovery priorities.</li>`;
    return;
  }

  snapshot.dashboard.today_priorities.forEach((priority) => {
    const item = document.createElement("li");
    item.className = "stack-item";
    item.innerHTML = `
      <p class="item-title">
        <span class="${severityPillClass(priority.severity)}">${priority.severity}</span>
        ${priority.title}
      </p>
      <p class="item-meta">${priority.claim_ref} · Route: ${priority.route_to}</p>
      <p class="item-recommendation">${priority.recommendation}</p>
    `;
    list.appendChild(item);
  });
}

function renderNeedsReview(snapshot) {
  const list = document.getElementById("needsReviewList");
  list.innerHTML = "";

  if (!snapshot.dashboard.needs_review.length) {
    list.innerHTML = `<li class="stack-item">No live human-review items loaded. Secure access is required to view reviewer queues.</li>`;
    return;
  }

  snapshot.dashboard.needs_review.forEach((item) => {
    const li = document.createElement("li");
    li.className = "stack-item";
    li.innerHTML = `
      <p class="item-title"><span class="${severityPillClass(item.severity)}">${item.severity}</span>${item.claim_ref}</p>
      <p class="item-meta">Queue: ${item.status} · Route: ${item.route_to}</p>
      <p class="item-meta">SLA due: ${toLocalDate(item.sla_due_at)}</p>
    `;
    list.appendChild(li);
  });
}

function normalizeApprovalItem(item) {
  return {
    approval_id: item.approval_id,
    session_id: item.session_id,
    subject_id: item.subject_id,
    type: item.type,
    status: item.status,
    requested_by: item.requested_by,
    practice_name: item.practice_name || item.metadata?.practice_name || "Unknown practice",
    updated_at: item.updated_at || item.created_at || new Date().toISOString()
  };
}

function renderApprovalQueue(snapshot) {
  const summary = document.getElementById("approvalQueueSummary");
  const list = document.getElementById("approvalQueueList");
  const approvals = snapshot.automation?.approvals || { pending_count: 0, approved_count: 0, rejected_count: 0, pending_items: [] };
  const pendingItems = (approvals.pending_items || []).map(normalizeApprovalItem);
  const canOperate = opsReady();

  summary.textContent = `Pending: ${approvals.pending_count} · Approved: ${approvals.approved_count} · Rejected: ${approvals.rejected_count}`;
  renderApprovalOpsStatus(canOperate
    ? "Reviewer access is active. You can approve or reject pending queue items below."
    : "Save reviewer access above to enable approve/reject actions from this dashboard.");
  list.innerHTML = "";

  if (!pendingItems.length) {
    list.innerHTML = `<li class="stack-item">No pending approvals right now.</li>`;
    return;
  }

  pendingItems.forEach((item) => {
    const li = document.createElement("li");
    li.className = "stack-item";
    li.innerHTML = `
      <p class="item-title"><span class="${severityPillClass('medium')}">pending</span>${item.practice_name}</p>
      <p class="item-meta">Approval: ${item.approval_id} · Session: ${item.session_id}</p>
      <p class="item-meta">Type: ${item.type} · Requested by: ${item.requested_by}</p>
      <p class="item-meta">Updated: ${toLocalDate(item.updated_at)}</p>
      <div class="inline-actions">
        <button type="button" class="btn-secondary approval-action" data-action="approve" data-approval-id="${item.approval_id}" ${canOperate ? '' : 'disabled'}>Approve</button>
        <button type="button" class="btn-secondary approval-action" data-action="reject" data-approval-id="${item.approval_id}" ${canOperate ? '' : 'disabled'}>Reject</button>
      </div>
    `;
    list.appendChild(li);
  });
}

function renderOnboardingStatus(snapshot) {
  const list = document.getElementById("onboardingStatusList");
  const sessions = snapshot.onboarding?.sessions || [];
  list.innerHTML = "";

  if (!sessions.length) {
    list.innerHTML = `<li class="stack-item">No onboarding sessions are loaded yet. Start with upload-first intake or connect secure access.</li>`;
    return;
  }

  sessions.slice(0, 5).forEach((session) => {
    const li = document.createElement("li");
    li.className = "stack-item";
    const steps = (session.steps || [])
      .map((step) => `${step.done ? '✅' : '◻️'} ${step.label}`)
      .join("<br>");

    li.innerHTML = `
      <p class="item-title">${session.practice_name}</p>
      <p class="item-meta">Session: ${session.session_id} · Status: ${session.status}</p>
      <p class="item-meta">Lane: ${session.lane || 'unknown'} · Approval: ${session.approval_status} · Updated: ${toLocalDate(session.updated_at)}</p>
      ${session.latest_upload_batch_id ? `<p class="item-meta">Upload batch: ${session.latest_upload_batch_id} · Files: ${session.upload_artifact_count || 0}</p>` : ''}
      <p class="item-recommendation">${steps}</p>
    `;
    list.appendChild(li);
  });
}

function renderClaims(snapshot) {
  const body = document.getElementById("claimsTableBody");
  body.innerHTML = "";

  if (!snapshot.dashboard.claims_at_risk.length) {
    body.innerHTML = `<tr><td colspan="5">No live claim-risk or recovery rows loaded. Connect secure access to view worklists.</td></tr>`;
    return;
  }

  snapshot.dashboard.claims_at_risk.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.claim_ref}</td>
      <td><span class="${severityPillClass(row.highest_severity)}">${row.highest_severity}</span></td>
      <td>${row.finding_count}</td>
      <td>${row.categories.join(", ")}</td>
      <td>${row.recommended_next_step}</td>
    `;
    body.appendChild(tr);
  });
}

function answerQuestion(question, snapshot) {
  const normalized = question.trim().toLowerCase();
  const top = snapshot.dashboard.today_priorities[0];
  const openReviewCount = snapshot.dashboard.needs_review.length;
  const approvals = snapshot.automation?.approvals || { pending_count: 0, pending_items: [] };
  const latestSession = (snapshot.onboarding?.sessions || [])[0];

  if (!normalized) {
    return "Please enter a question first.";
  }

  if (normalized.includes("approval") || normalized.includes("blocked")) {
    if (!approvals.pending_items.length) {
      return "Nothing is currently blocked on approval in this snapshot.";
    }

    const topApproval = normalizeApprovalItem(approvals.pending_items[0]);
    return [
      `There are ${approvals.pending_count} approval item(s) pending.`,
      `Top approval: ${topApproval.practice_name} (${topApproval.approval_id}).`,
      "Next step: manual review must approve live-read access before connection-test should pass."
    ].join("\n");
  }

  if (normalized.includes("first") || normalized.includes("priority") || normalized.includes("morning")) {
    if (!top) return "No live priorities are loaded yet. Connect secure access or start onboarding intake first.";

    return [
      `Start with ${top.title} (${top.severity}) on ${top.claim_ref}.`,
      `Why: ${top.recommendation}`,
      `Route this to: ${top.route_to}.`,
      "Reminder: keep actions in draft mode until human review is complete."
    ].join("\n");
  }

  if (normalized.includes("highest") || normalized.includes("risk")) {
    const risk = snapshot.dashboard.claims_at_risk[0];
    if (!risk) return "No live claim-risk records are loaded yet. Connect secure access to view authenticated worklists.";
    return [
      `Highest-risk claim: ${risk.claim_ref} (${risk.highest_severity}).`,
      `Findings: ${risk.finding_count}. Categories: ${risk.categories.join(", ")}.`,
      `Recommended next step: ${risk.recommended_next_step}`
    ].join("\n");
  }

  if (normalized.includes("needs review") || normalized.includes("review")) {
    return `Needs Review currently has ${openReviewCount} open human-review item(s). Prioritize critical/high severity before medium.`;
  }

  if (normalized.includes("roi") || normalized.includes("proof") || normalized.includes("pilot")) {
    const pilot = snapshot.automation?.pilot_roi || { baseline_count: 0, tracked_practices: [] };
    return [
      `Pilot ROI tracking is enabled for ${pilot.baseline_count} practice(s).`,
      `Tracked practices: ${(pilot.tracked_practices || []).join(", ") || "none yet"}.`,
      "Use the pilot baseline, event, and report endpoints to track dollars recovered, dollars protected, and staff time saved.",
      "Important: the repo provides the measurement spine, but real ROI proof still depends on actual pilot data entry."
    ].join("\n");
  }

  if (normalized.includes("denial") || normalized.includes("taxonomy") || normalized.includes("bucket")) {
    const denial = snapshot.automation?.denial_intelligence || { taxonomy_count: 0, taxonomy_preview: [] };
    return [
      `PMHNP denial intelligence currently tracks ${denial.taxonomy_count} specialty bucket(s).`,
      `Preview: ${(denial.taxonomy_preview || []).map((item) => `${item.code} → ${item.route_to}`).join('; ') || 'none loaded'}.`,
      "This product is positioned as PMHNP Claim Guard: pre-submit risk checks plus denial recovery, not a generic autonomous billing system."
    ].join("\n");
  }

  if (normalized.includes("tebra") || normalized.includes("onboard") || normalized.includes("connect")) {
    const latestStatus = latestSession ? `Latest onboarding session: ${latestSession.practice_name} is ${latestSession.status} on the ${latestSession.lane || 'unknown'} lane.` : "No onboarding sessions are loaded yet.";
    return [
      "Connect Tebra status:",
      "• Easiest now: upload Tebra exports for immediate review.",
      "• Best long-term: admin-assisted live SOAP sync for serious users.",
      "• Human-gated: live-read approval queue before connection tests should pass.",
      "• Not yet live: direct in-app Tebra OAuth and automatic claim submission.",
      latestStatus
    ].join("\n");
  }

  if (snapshot.ask_worklist.top_finding_preview) {
    const preview = snapshot.ask_worklist.top_finding_preview;
    return [
      preview.what_happened,
      `Why it matters: ${preview.why_it_matters}`,
      `Next steps: ${preview.recommended_next_steps.join("; ")}`,
      `Confidence: ${preview.confidence}. Uncertainty: ${preview.main_uncertainty}`
    ].join("\n");
  }

  return "I can summarize priorities, claim-risk and recovery worklists, needs review, onboarding status, or what is blocked on approval right now.";
}

function renderPrompts(snapshot) {
  const container = document.getElementById("suggestedPrompts");
  const questionInput = document.getElementById("workbenchQuestion");
  container.innerHTML = "";

  (snapshot.ask_worklist.suggested_prompts || []).forEach((prompt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = prompt;
    btn.addEventListener("click", () => {
      questionInput.value = prompt;
      questionInput.focus();
    });
    container.appendChild(btn);
  });
}

function wireAskForm(snapshot) {
  const form = document.getElementById("askWorkbenchForm");
  const questionInput = document.getElementById("workbenchQuestion");
  const responseEl = document.getElementById("workbenchResponse");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    responseEl.textContent = answerQuestion(questionInput.value, snapshot);
  });
}

function renderSourceLine(snapshot) {
  const sourceLine = document.getElementById("dataSourceLine");
  let sourceType = "public shell";

  if (snapshot.source.type === "pmhnp-denial-copilot-state") {
    sourceType = "local backend snapshot";
  } else if (snapshot.source.type === "app-shell") {
    sourceType = "public shell";
  } else if (snapshot.source.type === "operational-api-client-live") {
    sourceType = "live client portal";
  }

  const approvals = snapshot.automation?.approvals?.pending_count || 0;
  sourceLine.textContent = `Mode: ${sourceType} · Run: ${snapshot.source.run_id} · Findings: ${snapshot.source.finding_count} · Pending approvals: ${approvals} · Generated: ${toLocalDate(snapshot.generated_at)}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let payload = {};
  try {
    payload = await response.json();
  } catch (_error) {
    payload = {};
  }

  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function resolveClientApiBase(preferredBase = "") {
  return preferredBase || getSavedAccessConfig().apiBase || window.location.origin;
}

function resolveOpsApiBase(preferredBase = "") {
  return preferredBase || getSavedOpsConfig().apiBase || getSavedAccessConfig().apiBase || window.location.origin;
}

async function exchangeClientAccessKey(accessKey, preferredBase = "") {
  return fetchJson(new URL('/v1/auth/client/login', resolveClientApiBase(preferredBase)).toString(), {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_key: accessKey, actor_id: 'browser-client' })
  });
}

async function exchangeOpsAccessKey(accessKey, actorId, preferredBase = "") {
  return fetchJson(new URL('/v1/auth/ops/login', resolveOpsApiBase(preferredBase)).toString(), {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_key: accessKey, actor_id: actorId })
  });
}

async function loadLiveSnapshot() {
  const { token, apiBase } = getSavedAccessConfig();
  if (!token) return null;

  const snapshotUrl = new URL("/client/snapshot", resolveClientApiBase(apiBase)).toString();

  return fetchJson(snapshotUrl, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

async function loadSnapshot() {
  try {
    const live = await loadLiveSnapshot();
    if (live) {
      renderAccessStatus("Live secure access connected.");
      return live;
    }
  } catch (_error) {
    renderAccessStatus("Secure token found, but live dashboard did not load. Showing empty shell until live access succeeds.");
  }

  return FALLBACK_SNAPSHOT;
}

function opsBaseUrl() {
  return resolveOpsApiBase();
}

async function opsFetch(pathname, { method = "GET", body } = {}) {
  const ops = getSavedOpsConfig();
  if (!opsReady()) {
    throw new Error("Reviewer access is not configured.");
  }

  const headers = {
    Authorization: `Bearer ${ops.token}`,
    'x-actor-id': ops.actorId,
    'x-role': ops.actorRole
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return fetchJson(new URL(pathname, opsBaseUrl()).toString(), {
    method,
    cache: 'no-store',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
}

function mergeLiveApprovals(snapshot, approvals = []) {
  const normalized = approvals.map(normalizeApprovalItem);
  const pendingCount = normalized.filter((item) => item.status === 'pending').length;
  const approvedCount = approvals.filter((item) => item.status === 'approved').length;
  const rejectedCount = approvals.filter((item) => item.status === 'rejected').length;

  return {
    ...snapshot,
    automation: {
      ...(snapshot.automation || {}),
      approvals: {
        pending_count: pendingCount,
        approved_count: approvedCount,
        rejected_count: rejectedCount,
        pending_items: normalized.filter((item) => item.status === 'pending')
      }
    }
  };
}

async function hydrateApprovalQueue(snapshot) {
  if (!opsReady()) return snapshot;

  try {
    const payload = await opsFetch('/v1/approvals');
    renderOpsStatus('Reviewer access connected. Approval operations are enabled.');
    return mergeLiveApprovals(snapshot, payload.approvals || []);
  } catch (error) {
    renderOpsStatus(`Reviewer access saved, but approval operations did not load (${error.status || 'error'}).`);
    return snapshot;
  }
}

function wireApprovalActions() {
  const buttons = Array.from(document.querySelectorAll('.approval-action'));
  if (!buttons.length || !opsReady()) return;

  buttons.forEach((button) => {
    button.addEventListener('click', async () => {
      const approvalId = button.dataset.approvalId;
      const action = button.dataset.action;
      if (!approvalId || !action) return;

      try {
        button.disabled = true;
        renderApprovalOpsStatus(`${action === 'approve' ? 'Approving' : 'Rejecting'} ${approvalId}...`);

        if (action === 'approve') {
          await opsFetch(`/v1/approvals/${approvalId}/approve`, { method: 'POST' });
          renderApprovalOpsStatus(`Approved ${approvalId}. Reloading queue...`);
        } else {
          const reason = window.prompt('Reason for rejection:', 'Need supporting documents before live-read approval.');
          if (reason == null) {
            renderApprovalOpsStatus('Rejection cancelled.');
            button.disabled = false;
            return;
          }
          await opsFetch(`/v1/approvals/${approvalId}/reject`, { method: 'POST', body: { reason } });
          renderApprovalOpsStatus(`Rejected ${approvalId}. Reloading queue...`);
        }

        window.location.reload();
      } catch (error) {
        button.disabled = false;
        renderApprovalOpsStatus(error.message || 'Approval operation failed.');
      }
    });
  });
}

async function bootstrap() {
  wireAccessForm();
  wireOpsForm();

  let snapshot = await loadSnapshot();
  snapshot = await hydrateApprovalQueue(snapshot);

  renderSourceLine(snapshot);
  renderPriorities(snapshot);
  renderNeedsReview(snapshot);
  renderApprovalQueue(snapshot);
  renderOnboardingStatus(snapshot);
  renderClaims(snapshot);
  renderPrompts(snapshot);
  wireAskForm(snapshot);
  wireApprovalActions();

  document.getElementById("reloadSnapshotBtn").addEventListener("click", () => {
    window.location.reload();
  });
}

bootstrap();
