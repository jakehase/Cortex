from __future__ import annotations

import json
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

import cortex_server.routers.orchestrator as orchestrator
from cortex_server.modules.reasoning_scheduler import create_process_from_workflow
from cortex_server.services import mission_control_service


router = APIRouter()


class MissionControlCreateRequest(BaseModel):
    kind: str = "roadmap"
    title: str
    objective: Optional[str] = None
    owner: str = "cortex"
    session_key: Optional[str] = None
    channel: Optional[str] = None
    conversation_id: Optional[str] = None
    process_id: Optional[str] = None
    workflow_prompt: Optional[str] = None
    workflow: Optional[Dict[str, Any]] = None
    roadmap: Dict[str, Any] = Field(default_factory=dict)
    delivery: Dict[str, Any] = Field(default_factory=dict)
    maintenance: Dict[str, Any] = Field(default_factory=dict)


class MissionControlActionRequest(BaseModel):
    action: str
    actor: str = "cortex"
    blocker_fingerprint: Optional[str] = None
    note: Optional[str] = None



def _merge_workflow_metadata(request: MissionControlCreateRequest, base: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    metadata = dict(base or {})
    metadata.setdefault("owner", request.owner)
    if request.session_key and not metadata.get("session_key"):
        metadata["session_key"] = request.session_key
    if request.channel and not metadata.get("channel"):
        metadata["channel"] = request.channel
    if request.conversation_id and not metadata.get("conversation_id"):
        metadata["conversation_id"] = request.conversation_id
    mission_control_meta = dict(metadata.get("mission_control") or {})
    mission_control_meta.update(
        {
            "created_via": "mission_control",
            "kind": request.kind,
            "title": request.title,
            "objective": request.objective or request.title,
        }
    )
    metadata["mission_control"] = mission_control_meta
    return metadata



def _default_workflow(request: MissionControlCreateRequest) -> Dict[str, Any]:
    objective = str(request.objective or request.title).strip() or request.title
    prompt = str(request.workflow_prompt or objective).strip() or objective
    return {
        "name": request.title,
        "metadata": _merge_workflow_metadata(request),
        "steps": [
            {
                "node_id": "objective",
                "title": f"Advance {request.title}",
                "endpoint": "/oracle/chat",
                "payload": {"message": prompt},
                "metadata": {"work_type": "feature"},
            }
        ],
    }



def _workflow_payload(request: MissionControlCreateRequest) -> Dict[str, Any]:
    workflow = dict(request.workflow or _default_workflow(request))
    workflow["name"] = str(workflow.get("name") or request.title).strip() or request.title
    steps = list(workflow.get("steps") or [])
    if not steps:
        workflow = _default_workflow(request)
        steps = list(workflow.get("steps") or [])
    workflow["steps"] = steps
    workflow["metadata"] = _merge_workflow_metadata(request, base=workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else None)
    return workflow


@router.get("/", response_class=HTMLResponse)
def mission_control_ui():
    html = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cortex Mission Control</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1020;
      --panel: #10182d;
      --panel-2: #0f1527;
      --line: #23304f;
      --text: #edf3ff;
      --muted: #9fb1d5;
      --accent: #77c3ff;
      --good: #37d39a;
      --warn: #f5b84f;
      --bad: #ff6b7d;
      --paused: #b197fc;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px/1.45 system-ui, sans-serif; background: var(--bg); color: var(--text); }
    header { padding: 20px 24px; border-bottom: 1px solid var(--line); display: flex; gap: 16px; align-items: center; justify-content: space-between; }
    h1 { margin: 0; font-size: 22px; }
    button, input, select, textarea {
      font: inherit; border-radius: 10px; border: 1px solid var(--line); background: #0d1425; color: var(--text);
      padding: 10px 12px;
    }
    button { cursor: pointer; }
    button.primary { background: #17325c; border-color: #2d5ea5; }
    .shell { display: grid; grid-template-columns: 420px 1fr; min-height: calc(100vh - 73px); }
    .left, .right { padding: 18px; }
    .left { border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 16px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 16px; }
    .summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .metric { background: var(--panel-2); border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
    .metric .label { color: var(--muted); font-size: 12px; }
    .metric .value { font-size: 20px; font-weight: 700; margin-top: 4px; }
    .create-form { display: grid; gap: 10px; }
    .card-list { display: grid; gap: 10px; overflow: auto; }
    .card { background: var(--panel-2); border: 1px solid var(--line); border-radius: 14px; padding: 14px; cursor: pointer; }
    .card.active { border-color: var(--accent); box-shadow: 0 0 0 1px rgba(119,195,255,0.3) inset; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .row.between { justify-content: space-between; }
    .pill { border-radius: 999px; padding: 2px 8px; font-size: 12px; border: 1px solid var(--line); color: var(--muted); }
    .status-active { color: var(--good); border-color: rgba(55, 211, 154, 0.35); }
    .status-blocked { color: var(--bad); border-color: rgba(255, 107, 125, 0.35); }
    .status-paused { color: var(--paused); border-color: rgba(177, 151, 252, 0.35); }
    .status-pending { color: var(--warn); border-color: rgba(245, 184, 79, 0.35); }
    .status-completed { color: var(--accent); border-color: rgba(119, 195, 255, 0.35); }
    .muted { color: var(--muted); }
    .detail-grid { display: grid; gap: 16px; }
    .kv { display: grid; grid-template-columns: 180px 1fr; gap: 10px; }
    .section-title { margin: 0 0 10px; font-size: 15px; }
    pre { white-space: pre-wrap; background: #0b1221; border: 1px solid var(--line); border-radius: 12px; padding: 12px; overflow: auto; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .mini-list { display: grid; gap: 8px; }
    .mini-item { border: 1px solid var(--line); border-radius: 12px; padding: 10px; background: #0b1221; }
    @media (max-width: 980px) {
      .shell { grid-template-columns: 1fr; }
      .left { border-right: 0; border-bottom: 1px solid var(--line); }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Cortex Mission Control</h1>
      <div class="muted">Unified operator view for roadmaps, runtime delivery, maintenance queue, blockers, and follow-through.</div>
    </div>
    <div class="row">
      <button id="refresh" class="primary">Refresh</button>
      <div id="generatedAt" class="muted"></div>
    </div>
  </header>
  <div class="shell">
    <div class="left">
      <div class="panel">
        <h3 class="section-title">Status</h3>
        <div id="summary" class="summary-grid"></div>
      </div>
      <div class="panel">
        <h3 class="section-title">Create objective</h3>
        <div class="create-form">
          <select id="kind">
            <option value="roadmap">Roadmap objective</option>
            <option value="delivery">Delivery objective</option>
            <option value="maintenance">Maintenance item</option>
          </select>
          <input id="title" placeholder="Title" />
          <textarea id="objective" rows="3" placeholder="Objective or source text"></textarea>
          <button id="create" class="primary">Create</button>
        </div>
      </div>
      <div class="panel" style="flex:1; min-height: 260px;">
        <div class="row between">
          <h3 class="section-title">Objectives</h3>
          <div id="count" class="muted"></div>
        </div>
        <div id="cards" class="card-list"></div>
      </div>
    </div>
    <div class="right">
      <div id="detail" class="detail-grid"></div>
    </div>
  </div>
  <script>
    const state = { board: null, selected: null };

    function escapeHtml(input) {
      return String(input ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }

    function fmtJson(value) {
      return escapeHtml(JSON.stringify(value ?? {}, null, 2));
    }

    function statusClass(status) {
      return `status-${String(status || '').toLowerCase()}`;
    }

    function renderSummary(summary) {
      const metrics = [
        ['Objectives', summary.objective_count],
        ['Blocked', summary.by_status?.blocked || 0],
        ['Paused', summary.paused_count || 0],
        ['Follow-ups due', summary.follow_up_due_count || 0],
        ['Queued outbound', summary.outbound_queued_count || 0],
        ['Failed outbound', summary.outbound_failed_count || 0],
      ];
      document.getElementById('summary').innerHTML = metrics.map(([label, value]) => `
        <div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>
      `).join('');
    }

    function renderCards(objectives) {
      const container = document.getElementById('cards');
      document.getElementById('count').textContent = `${objectives.length} visible`;
      container.innerHTML = objectives.map(row => `
        <div class="card ${state.selected === row.objective_key ? 'active' : ''}" data-key="${escapeHtml(row.objective_key)}">
          <div class="row between">
            <strong>${escapeHtml(row.title)}</strong>
            <span class="pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span>
          </div>
          <div class="row" style="margin-top:8px;">
            ${(row.source_types || []).map(kind => `<span class="pill">${escapeHtml(kind)}</span>`).join('')}
          </div>
          <div class="muted" style="margin-top:8px;">${escapeHtml(row.next_action?.kind || row.current_phase?.delivery_stage || row.current_phase?.roadmap_phase_id || 'No next action')}</div>
          <div class="row between" style="margin-top:8px;">
            <span class="muted">Worker: ${escapeHtml(row.active_worker?.agent_id || 'unassigned')}</span>
            <span class="muted">Blockers: ${escapeHtml(row.blocker_status?.open_count || 0)}</span>
          </div>
        </div>
      `).join('');
      container.querySelectorAll('.card').forEach(card => card.onclick = () => loadDetail(card.dataset.key));
    }

    function detailSection(title, body) {
      return `<div class="panel"><h3 class="section-title">${escapeHtml(title)}</h3>${body}</div>`;
    }

    function renderDetail(payload) {
      const objective = payload?.objective;
      const detail = document.getElementById('detail');
      if (!objective) {
        detail.innerHTML = detailSection('Objective', '<div class="muted">Select an objective.</div>');
        return;
      }
      const actions = (objective.available_actions || []).map(action => `
        <button data-action="${escapeHtml(action.action)}">${escapeHtml(action.label)}</button>
      `).join('');
      const blockers = (objective.blockers || []).map(blocker => `
        <div class="mini-item">
          <div class="row between">
            <strong>${escapeHtml(blocker.summary || blocker.source || 'blocker')}</strong>
            <span class="pill ${blocker.acknowledged ? 'status-completed' : 'status-blocked'}">${blocker.acknowledged ? 'acknowledged' : 'open'}</span>
          </div>
          <div class="muted" style="margin-top:6px;">${escapeHtml(blocker.blocker_class || blocker.source || '')}</div>
          <div class="actions"><button data-action="acknowledge_blocker" data-fingerprint="${escapeHtml(blocker.fingerprint)}">Acknowledge</button></div>
        </div>
      `).join('') || '<div class="muted">No live blockers.</div>';
      const reports = (objective.recent_reports || []).map(report => `
        <div class="mini-item">
          <div class="row between">
            <strong>${escapeHtml(report.kind || report.runtime_kind)}</strong>
            <span class="muted">${escapeHtml(report.recorded_at || '')}</span>
          </div>
          <div>${escapeHtml(report.summary || '')}</div>
        </div>
      `).join('') || '<div class="muted">No reports yet.</div>';
      const followups = (payload.follow_up_dispatches || []).slice(0, 6).map(row => `
        <div class="mini-item">
          <div class="row between">
            <strong>${escapeHtml(row.update_kind || row.runtime_kind)}</strong>
            <span class="pill">${escapeHtml(row.delivery_status)}</span>
          </div>
          <div>${escapeHtml(row.summary || row.title || '')}</div>
        </div>
      `).join('') || '<div class="muted">No outbound follow-up dispatches.</div>';
      detail.innerHTML = [
        detailSection('Objective', `
          <div class="row between"><div><h2 style="margin:0;">${escapeHtml(objective.title)}</h2><div class="muted">${escapeHtml(objective.objective_key)}</div></div><span class="pill ${statusClass(objective.status)}">${escapeHtml(objective.status)}</span></div>
          <div class="actions">${actions}</div>
          <div class="kv" style="margin-top:12px;">
            <div class="muted">Current phase</div><div>${escapeHtml(objective.current_phase?.delivery_stage || objective.current_phase?.roadmap_phase_id || '—')}</div>
            <div class="muted">Next action</div><div>${escapeHtml(objective.next_action?.kind || '—')}</div>
            <div class="muted">Active worker</div><div>${escapeHtml(objective.active_worker?.agent_id || 'unassigned')}</div>
            <div class="muted">Follow-up due</div><div>${escapeHtml(objective.follow_up?.due_at || '—')}</div>
            <div class="muted">Conversation</div><div>${escapeHtml(objective.conversation_ownership?.conversation_id || objective.conversation_ownership?.session_key || '—')}</div>
          </div>
        `),
        detailSection('Blockers', `<div class="mini-list">${blockers}</div>`),
        detailSection('Recent reports', `<div class="mini-list">${reports}</div>`),
        detailSection('Outbound follow-up', `<div class="mini-list">${followups}</div>`),
        detailSection('Raw detail', `<pre>${fmtJson({ roadmap_detail: payload.roadmap_detail, delivery_detail: payload.delivery_detail, shared_state_history: payload.shared_state_history, runtime_events: payload.runtime_events })}</pre>`),
      ].join('');
      detail.querySelectorAll('button[data-action]').forEach(button => {
        button.onclick = () => runAction(button.dataset.action, button.dataset.fingerprint || null);
      });
    }

    async function fetchJson(url, options) {
      const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...(options || {}) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || response.statusText);
      return payload;
    }

    async function loadBoard() {
      const payload = await fetchJson('/mission_control/objectives');
      state.board = payload;
      document.getElementById('generatedAt').textContent = payload.generated_at || '';
      renderSummary(payload.summary || {});
      renderCards(payload.objectives || []);
      if (!state.selected && payload.objectives?.length) state.selected = payload.objectives[0].objective_key;
      if (state.selected) await loadDetail(state.selected);
    }

    async function loadDetail(key) {
      state.selected = key;
      renderCards(state.board?.objectives || []);
      const payload = await fetchJson(`/mission_control/objectives/${encodeURIComponent(key)}`);
      renderDetail(payload);
    }

    async function createObjective() {
      const kind = document.getElementById('kind').value;
      const title = document.getElementById('title').value.trim();
      const objective = document.getElementById('objective').value.trim();
      if (!title) return alert('Title required');
      const payload = { kind, title, objective };
      if (kind === 'maintenance') {
        payload.maintenance = { text: objective || title, title, objective: objective || title };
      }
      if (kind === 'roadmap') {
        payload.roadmap = {};
      }
      if (kind === 'delivery') {
        payload.delivery = {};
      }
      const created = await fetchJson('/mission_control/objectives', { method: 'POST', body: JSON.stringify(payload) });
      state.selected = created.objective.objective_key;
      await loadBoard();
    }

    async function runAction(action, blockerFingerprint) {
      if (!state.selected) return;
      const note = action === 'requeue' ? prompt('Optional note / reason', 'operator_requeue') : null;
      const payload = { action, blocker_fingerprint: blockerFingerprint, note };
      await fetchJson(`/mission_control/objectives/${encodeURIComponent(state.selected)}/actions`, { method: 'POST', body: JSON.stringify(payload) });
      await loadBoard();
    }

    document.getElementById('refresh').onclick = () => loadBoard().catch(err => alert(err.message));
    document.getElementById('create').onclick = () => createObjective().catch(err => alert(err.message));
    loadBoard().catch(err => {
      document.getElementById('detail').innerHTML = detailSection('Mission Control unavailable', `<pre>${escapeHtml(err.message)}</pre>`);
    });
  </script>
</body>
</html>
    """
    return HTMLResponse(html)


@router.get("/ui", response_class=HTMLResponse)
def mission_control_ui_alias():
    return mission_control_ui()


@router.get("/status")
def mission_control_status():
    return mission_control_service.status()


@router.get("/queue")
def mission_control_queue():
    return mission_control_service.queue()


@router.get("/reports")
def mission_control_reports(limit: int = 25):
    return mission_control_service.reports(limit=limit)


@router.get("/objectives")
def mission_control_objectives():
    return mission_control_service.objectives()


@router.get("/objectives/{objective_key}")
def mission_control_objective_detail(objective_key: str):
    return mission_control_service.objective_detail(objective_key)


@router.post("/objectives")
async def mission_control_create_objective(request: MissionControlCreateRequest):
    kind = str(request.kind or "roadmap").strip().lower()
    if kind == "maintenance":
        maintenance = dict(request.maintenance or {})
        message = dict(maintenance.get("message") or {})
        if request.channel and not message.get("channel"):
            message["channel"] = request.channel
        if request.conversation_id and not message.get("conversation_id"):
            message["conversation_id"] = request.conversation_id
        if request.session_key and not message.get("session_key"):
            message["session_key"] = request.session_key
        maintenance["message"] = message
        maintenance.setdefault("title", request.title)
        maintenance.setdefault("objective", request.objective or request.title)
        maintenance.setdefault("text", request.objective or request.title)
        intake = await orchestrator.intake_runtime_maintenance_item(orchestrator.RuntimeMaintenanceIntakeRequest(**maintenance))
        item_id = ((intake.get("item") or {}).get("item_id"))
        if not item_id:
            raise HTTPException(status_code=500, detail="maintenance intake did not return item_id")
        return mission_control_service.objective_detail(item_id)

    workflow = _workflow_payload(request)
    process = create_process_from_workflow(
        workflow,
        process_id=request.process_id,
        owner=request.owner,
        session_key=request.session_key,
    )

    if kind == "roadmap":
        roadmap = dict(request.roadmap or {})
        roadmap.setdefault("objective", request.objective or request.title)
        await orchestrator.reconcile_runtime_roadmap(
            process["process_id"],
            orchestrator.RuntimeRoadmapReconcileRequest(**roadmap),
        )
        return mission_control_service.objective_detail(process["process_id"])

    if kind == "delivery":
        delivery = dict(request.delivery or {})
        delivery.setdefault("objective", request.objective or request.title)
        await orchestrator.reconcile_runtime_delivery(
            process["process_id"],
            orchestrator.RuntimeDeliveryReconcileRequest(**delivery),
        )
        return mission_control_service.objective_detail(process["process_id"])

    raise HTTPException(status_code=400, detail=f"unsupported Mission Control objective kind '{request.kind}'")


@router.post("/objectives/{objective_key}/actions")
def mission_control_objective_action(objective_key: str, request: MissionControlActionRequest):
    return mission_control_service.process_action(
        objective_key,
        action=request.action,
        actor=request.actor,
        blocker_fingerprint=request.blocker_fingerprint,
        note=request.note,
    )
