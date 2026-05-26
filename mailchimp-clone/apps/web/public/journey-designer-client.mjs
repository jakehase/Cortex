export function buildJourneyDesignerState(seed = {}) {
  const nodes = Array.isArray(seed.nodes) && seed.nodes.length ? seed.nodes : [{ id: 'node_start', type: 'trigger', title: seed.trigger || 'Journey trigger' }];
  const normalizedNodes = nodes.map((node, index) => ({
    id: node.id || `node_${index + 1}`,
    type: node.type || 'email',
    title: node.title || node.type || `Step ${index + 1}`,
    delayHours: Number(node.delayHours || 0),
    conditions: Array.isArray(node.conditions) ? [...node.conditions] : [],
    x: Number(node.x ?? (index * 220)),
    y: Number(node.y ?? ((index % 2) * 120))
  }));
  return {
    automationId: seed.automationId || 'journey',
    name: seed.name || 'Customer journey',
    trigger: seed.trigger || 'contact_subscribed',
    goal: seed.goal || '',
    canvasMode: seed.canvasMode || 'design',
    previewContact: seed.previewContact || { segment: 'all_contacts', activity: 'subscribed' },
    selectedNodeId: seed.selectedNodeId || normalizedNodes[0]?.id || null,
    nodes: normalizedNodes,
    history: Array.isArray(seed.history) ? seed.history : [],
    future: Array.isArray(seed.future) ? seed.future : []
  };
}

function snapshot(state) {
  return JSON.stringify({
    nodes: state.nodes,
    selectedNodeId: state.selectedNodeId,
    canvasMode: state.canvasMode,
    previewContact: state.previewContact
  });
}

function withHistory(state, next) {
  return { ...next, history: [...(state.history || []), snapshot(state)].slice(-20), future: [] };
}

export function reorderJourneyNode(state, nodeId, direction) {
  const index = state.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return state;
  const target = direction === 'up' ? Math.max(0, index - 1) : Math.min(state.nodes.length - 1, index + 1);
  if (target === index) return state;
  const nodes = [...state.nodes];
  const [node] = nodes.splice(index, 1);
  nodes.splice(target, 0, node);
  return withHistory(state, { ...state, nodes, selectedNodeId: nodeId });
}

export function duplicateJourneyNode(state, nodeId) {
  const index = state.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return state;
  const source = state.nodes[index];
  const copy = { ...source, id: `${source.id}_copy_${state.nodes.length + 1}`, title: `${source.title} copy`, x: source.x + 40, y: source.y + 40 };
  const nodes = [...state.nodes.slice(0, index + 1), copy, ...state.nodes.slice(index + 1)];
  return withHistory(state, { ...state, nodes, selectedNodeId: copy.id });
}

export function updateBranchConditions(state, nodeId, conditions = []) {
  const normalized = Array.isArray(conditions) ? conditions.map((entry) => String(entry).trim()).filter(Boolean) : String(conditions).split(',').map((entry) => entry.trim()).filter(Boolean);
  const nodes = state.nodes.map((node) => node.id === nodeId ? { ...node, type: node.type === 'branch' ? 'branch' : node.type, conditions: normalized } : node);
  return withHistory(state, { ...state, nodes, selectedNodeId: nodeId });
}

export function moveJourneyNode(state, nodeId, position = {}) {
  const nodes = state.nodes.map((node) => node.id === nodeId ? { ...node, x: Number(position.x ?? node.x), y: Number(position.y ?? node.y) } : node);
  return withHistory(state, { ...state, nodes, selectedNodeId: nodeId });
}

export function setJourneyPreviewContact(state, previewContact = {}) {
  return withHistory(state, { ...state, previewContact: { ...state.previewContact, ...previewContact } });
}

export function setJourneyCanvasMode(state, canvasMode) {
  return withHistory(state, { ...state, canvasMode: canvasMode || 'design' });
}

export function undoJourneyDesigner(state) {
  const last = state.history?.[state.history.length - 1];
  if (!last) return state;
  const restored = JSON.parse(last);
  return { ...state, ...restored, history: state.history.slice(0, -1), future: [snapshot(state), ...(state.future || [])] };
}

export function redoJourneyDesigner(state) {
  const next = state.future?.[0];
  if (!next) return state;
  const restored = JSON.parse(next);
  return { ...state, ...restored, history: [...(state.history || []), snapshot(state)], future: state.future.slice(1) };
}

export function serializeJourneyDesigner(state) {
  return JSON.stringify({
    automationId: state.automationId,
    name: state.name,
    trigger: state.trigger,
    goal: state.goal,
    canvasMode: state.canvasMode,
    previewContact: state.previewContact,
    selectedNodeId: state.selectedNodeId,
    nodes: state.nodes.map(({ id, type, title, delayHours, conditions, x, y }) => ({ id, type, title, delayHours, conditions, x, y }))
  });
}

function render(root, state) {
  root.innerHTML = `<div class="journey-designer" data-selected-node="${state.selectedNodeId || ''}" data-canvas-mode="${state.canvasMode}"><div class="toolbar"><strong>Visual journey orchestration</strong><span>Mode: ${state.canvasMode}</span><span>Preview: ${state.previewContact.segment || 'all_contacts'}</span></div><ol>${state.nodes.map((node) => `<li data-node-id="${node.id}"><button data-action="select" data-node-id="${node.id}">${node.title}</button><span>${node.type}</span><span>${(node.conditions || []).join(' / ')}</span></li>`).join('')}</ol><textarea readonly data-serialized-journey-state>${serializeJourneyDesigner(state)}</textarea></div>`;
}

export function attachJourneyDesigner(root, seed = {}) {
  let state = buildJourneyDesignerState(seed);
  const update = (next) => { state = next; render(root, state); return state; };
  root.addEventListener('click', (event) => {
    const action = event.target?.dataset?.action;
    const nodeId = event.target?.dataset?.nodeId;
    if (action === 'select' && nodeId) update({ ...state, selectedNodeId: nodeId });
  });
  render(root, state);
  return {
    getState: () => state,
    reorder: (nodeId, direction) => update(reorderJourneyNode(state, nodeId, direction)),
    duplicate: (nodeId) => update(duplicateJourneyNode(state, nodeId)),
    updateBranch: (nodeId, conditions) => update(updateBranchConditions(state, nodeId, conditions)),
    move: (nodeId, position) => update(moveJourneyNode(state, nodeId, position)),
    preview: (previewContact) => update(setJourneyPreviewContact(state, previewContact)),
    mode: (canvasMode) => update(setJourneyCanvasMode(state, canvasMode)),
    undo: () => update(undoJourneyDesigner(state)),
    redo: () => update(redoJourneyDesigner(state)),
    serialize: () => serializeJourneyDesigner(state)
  };
}

if (typeof document !== 'undefined') {
  for (const root of document.querySelectorAll('[data-journey-designer-client]')) {
    const script = document.getElementById(root.dataset.stateScript || '');
    const seed = script ? JSON.parse(script.textContent || '{}') : {};
    attachJourneyDesigner(root, seed);
  }
}
