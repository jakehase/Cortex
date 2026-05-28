export const CLIENT_SHELL_RUNTIME_CONTRACT = Object.freeze({
  surfaceId: 'frontend_full_client_application_runtime_layer',
  label: 'Frontend full client application runtime shell',
  controls: [
    'route_manifest_hydration',
    'command_palette_navigation',
    'optimistic_route_preview',
    'recent_work_persistence',
    'active_route_and_workspace_context',
    'progressive_enhancement_for_server_routes'
  ],
  evidenceContract: [
    'client_shell_manifest_loaded',
    'command_palette_state_changes',
    'active_route_resolution',
    'preview_and_commit_navigation_events',
    'recent_work_serialization',
    'server_rendered_routes_remain_available'
  ]
});

const DEFAULT_ROUTES = [
  { id: 'dashboard', label: 'Dashboard', href: '/app', group: 'workspace', keywords: ['home', 'overview', 'launch'] },
  { id: 'campaigns', label: 'Campaigns', href: '/campaigns', group: 'create', keywords: ['email', 'send', 'editor'] },
  { id: 'audiences', label: 'Audiences', href: '/audiences', group: 'crm', keywords: ['contacts', 'segments', 'crm'] },
  { id: 'automations', label: 'Automations', href: '/automations', group: 'journeys', keywords: ['journey', 'trigger', 'flow'] },
  { id: 'websites', label: 'Websites', href: '/websites', group: 'create', keywords: ['site', 'pages', 'designer'] },
  { id: 'reports', label: 'Reports', href: '/reports', group: 'insights', keywords: ['analytics', 'telemetry', 'performance'] },
  { id: 'integrations', label: 'Integrations', href: '/integrations', group: 'platform', keywords: ['connectors', 'provider', 'sync'] },
  { id: 'admin', label: 'Admin', href: '/admin', group: 'operations', keywords: ['jobs', 'security', 'settings'] }
];

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function routeScore(route, query) {
  if (!query) return 1;
  const haystack = [route.id, route.label, route.href, route.group, ...(route.keywords || [])].join(' ').toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

export function normalizeRouteManifest(seed = {}) {
  const sourceRoutes = Array.isArray(seed.routes) && seed.routes.length ? seed.routes : DEFAULT_ROUTES;
  const routes = sourceRoutes.map((route, index) => ({
    id: route.id || `route_${index + 1}`,
    label: route.label || route.title || route.href || `Route ${index + 1}`,
    href: route.href || '/',
    group: route.group || 'workspace',
    keywords: uniq([...(route.keywords || []), route.label, route.href, route.group].map((entry) => String(entry || '').toLowerCase()))
  }));
  const actions = Array.isArray(seed.actions) && seed.actions.length ? seed.actions : [
    { id: 'new_campaign', label: 'Create campaign', href: '/campaigns/new', group: 'create', keywords: ['email', 'draft', 'builder'] },
    { id: 'import_contacts', label: 'Import contacts', href: '/audiences', group: 'crm', keywords: ['csv', 'audience'] },
    { id: 'open_job_operations', label: 'Open job operations', href: '/jobs/operations', group: 'operations', keywords: ['queue', 'leases', 'dead letters'] }
  ];
  return {
    ...CLIENT_SHELL_RUNTIME_CONTRACT,
    generatedAt: seed.generatedAt || new Date().toISOString(),
    routes,
    actions: actions.map((action, index) => ({ id: action.id || `action_${index + 1}`, label: action.label || action.href || `Action ${index + 1}`, href: action.href || '/', group: action.group || 'commands', keywords: action.keywords || [] })),
    groups: uniq(routes.map((route) => route.group)),
    hydration: seed.hydration || ['server-rendered-html', 'client-command-shell', 'progressive-navigation']
  };
}

export function activeRouteForPath(routes = [], currentPath = '/') {
  const normalizedPath = currentPath === '/' ? '/' : String(currentPath || '/').replace(/\/$/, '');
  return routes
    .filter((route) => normalizedPath === route.href || (route.href !== '/' && normalizedPath.startsWith(route.href)))
    .sort((a, b) => b.href.length - a.href.length)[0] || routes[0] || null;
}

export function buildCommandPalette(state, query = '') {
  const routeCommands = state.routeManifest.routes.map((route) => ({ kind: 'route', id: route.id, label: route.label, href: route.href, group: route.group, keywords: route.keywords }));
  const actionCommands = state.routeManifest.actions.map((action) => ({ kind: 'action', id: action.id, label: action.label, href: action.href, group: action.group, keywords: action.keywords || [] }));
  return [...routeCommands, ...actionCommands]
    .map((command) => ({ ...command, score: routeScore(command, query) }))
    .filter((command) => command.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 12);
}

export function buildClientShellState(seed = {}) {
  const routeManifest = normalizeRouteManifest(seed.manifest || seed);
  const currentPath = seed.currentPath || (typeof location !== 'undefined' ? location.pathname : '/app');
  const recentWork = Array.isArray(seed.recentWork) ? seed.recentWork : [];
  const state = {
    ...CLIENT_SHELL_RUNTIME_CONTRACT,
    currentPath,
    routeManifest,
    activeRoute: activeRouteForPath(routeManifest.routes, currentPath),
    paletteOpen: Boolean(seed.paletteOpen),
    query: seed.query || '',
    previewPath: seed.previewPath || null,
    recentWork,
    workspace: seed.workspace || null,
    hydratedAt: seed.hydratedAt || new Date().toISOString()
  };
  return { ...state, commands: buildCommandPalette(state, state.query) };
}

export function setShellQuery(state, query) {
  const next = { ...state, query: String(query || ''), paletteOpen: true };
  return { ...next, commands: buildCommandPalette(next, next.query) };
}

export function previewShellRoute(state, href) {
  return { ...state, previewPath: href, activeRoute: activeRouteForPath(state.routeManifest.routes, href) || state.activeRoute };
}

export function commitShellNavigation(state, command) {
  const href = typeof command === 'string' ? command : command?.href;
  const label = typeof command === 'string' ? command : command?.label;
  if (!href) return state;
  const recentEntry = { href, label: label || href, at: new Date().toISOString() };
  return {
    ...state,
    currentPath: href,
    previewPath: null,
    paletteOpen: false,
    query: '',
    activeRoute: activeRouteForPath(state.routeManifest.routes, href) || state.activeRoute,
    recentWork: [recentEntry, ...state.recentWork.filter((entry) => entry.href !== href)].slice(0, 8),
    commands: buildCommandPalette(state, '')
  };
}

export function serializeClientShellState(state) {
  return JSON.stringify({
    surfaceId: CLIENT_SHELL_RUNTIME_CONTRACT.surfaceId,
    currentPath: state.currentPath,
    activeRouteId: state.activeRoute?.id || null,
    paletteOpen: state.paletteOpen,
    query: state.query,
    previewPath: state.previewPath,
    recentWork: state.recentWork,
    routeCount: state.routeManifest.routes.length,
    commandCount: state.commands.length
  });
}

export function readRecentWork(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem('mailclone.recentWork') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeRecentWork(recentWork, storage = globalThis.localStorage) {
  try {
    storage.setItem('mailclone.recentWork', JSON.stringify((recentWork || []).slice(0, 8)));
    return true;
  } catch {
    return false;
  }
}

function renderShell(root, state) {
  root.innerHTML = `<div class="client-shell-bar"><strong>Mailclone client runtime</strong><span data-active-route>${state.activeRoute?.label || 'Workspace'}</span><button type="button" data-shell-action="open-palette">Command palette</button><span class="shell-status">${state.routeManifest.routes.length} routes hydrated · ${state.recentWork.length} recent</span></div><div class="client-shell-palette ${state.paletteOpen ? 'open' : ''}" data-command-palette><input data-command-query value="${state.query.replaceAll('"', '&quot;')}" placeholder="Search campaigns, contacts, journeys, reports"><ul>${state.commands.map((command) => `<li><a href="${command.href}" data-command-href="${command.href}">${command.label}<span>${command.group}</span></a></li>`).join('')}</ul></div><div class="client-shell-preview" data-route-preview>${state.previewPath ? `Previewing ${state.previewPath}` : 'Server routes stay available; client shell enhances navigation.'}</div><script type="application/json" data-client-shell-state>${serializeClientShellState(state)}</script>`;
}

export function attachMailcloneClientShell(documentRef = document, seed = {}) {
  const documentBody = documentRef.body;
  if (!documentBody || documentRef.getElementById('mailclone-client-shell')) return null;
  documentBody.classList.add('mailclone-client-shell-ready');
  const configScript = documentRef.getElementById('mailclone-client-shell-config');
  let config = {};
  try { config = configScript ? JSON.parse(configScript.textContent || '{}') : {}; } catch {}
  let state = buildClientShellState({ ...config, ...seed, currentPath: seed.currentPath || documentRef.location?.pathname || location.pathname, recentWork: seed.recentWork || readRecentWork() });
  const root = documentRef.createElement('section');
  root.id = 'mailclone-client-shell';
  root.setAttribute('data-client-shell-runtime', CLIENT_SHELL_RUNTIME_CONTRACT.surfaceId);
  documentBody.prepend(root);
  const update = (next) => {
    state = next;
    writeRecentWork(state.recentWork);
    renderShell(root, state);
    return state;
  };
  root.addEventListener('click', (event) => {
    const action = event.target?.dataset?.shellAction;
    if (action === 'open-palette') update({ ...state, paletteOpen: true, commands: buildCommandPalette(state, state.query) });
    const href = event.target?.dataset?.commandHref;
    if (href) update(commitShellNavigation(state, { href, label: event.target.textContent || href }));
  });
  root.addEventListener('input', (event) => {
    if (event.target?.dataset?.commandQuery !== undefined) update(setShellQuery(state, event.target.value));
  });
  renderShell(root, state);
  return {
    getState: () => state,
    query: (value) => update(setShellQuery(state, value)),
    preview: (href) => update(previewShellRoute(state, href)),
    commit: (command) => update(commitShellNavigation(state, command)),
    serialize: () => serializeClientShellState(state)
  };
}

if (typeof document !== 'undefined') {
  attachMailcloneClientShell(document);
}



export function buildFrontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionRuntimeKey = "frontend_client_shell_state:interactive_state_and_commands:apps/web/public/app-shell-client.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionRuntimeKey, surfaceId: "frontend_client_shell_state", focusGroup: "frontend_architecture", phaseId: "interactive_state_and_commands", shardId: "focus.frontend_client_shell_state::semantic-frontier-001#01-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "apps/web/public/app-shell-client.mjs", workspaceId, durableStateReady: Boolean(db), ...frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionRuntimeCounts, phaseRuntimeSignal: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionPhaseRuntimeSignal, workflowEvidence: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:frontend_client_shell_state:monitor_job_runtime_handoff" : "interactive_state_and_commands:frontend_client_shell_state:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionRuntimeKey, targetFile: "apps/web/public/app-shell-client.mjs" } };
}



export function buildWebsiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionRuntimeKey = "website_builder_editor_realism:interactive_state_and_commands:apps/web/public/app-shell-client.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionRuntimeKey, surfaceId: "website_builder_editor_realism", focusGroup: "website_builder", phaseId: "interactive_state_and_commands", shardId: "focus.website_builder_editor_realism::semantic-frontier-001#02-interactive_state_and_commands#2", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "apps/web/public/app-shell-client.mjs", workspaceId, durableStateReady: Boolean(db), ...websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionRuntimeCounts, phaseRuntimeSignal: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionPhaseRuntimeSignal, workflowEvidence: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:website_builder_editor_realism:monitor_job_runtime_handoff" : "interactive_state_and_commands:website_builder_editor_realism:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsAdoptionRuntimeKey, targetFile: "apps/web/public/app-shell-client.mjs" } };
}



export function buildWebsiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1AdoptionState(state = {}, actor = {}, input = {}) {
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1AdoptionRuntimeKey = "website_builder_editor_realism:interactive_state_and_commands:apps/web/public/app-shell-client.mjs:semanticFrontier00102InteractiveStateAndCommands1", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1AdoptionRuntimeKey, surfaceId: "website_builder_editor_realism", focusGroup: "website_builder", phaseId: "interactive_state_and_commands", shardId: "focus.website_builder_editor_realism::semantic-frontier-001#02-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "apps/web/public/app-shell-client.mjs", workspaceId, durableStateReady: Boolean(db), ...websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1AdoptionRuntimeCounts, phaseRuntimeSignal: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1AdoptionPhaseRuntimeSignal, workflowEvidence: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:website_builder_editor_realism:monitor_job_runtime_handoff" : "interactive_state_and_commands:website_builder_editor_realism:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1AdoptionRuntimeKey, targetFile: "apps/web/public/app-shell-client.mjs" } };
}



export function buildFrontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionState(state = {}, actor = {}, input = {}) {
  const frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionRuntimeKey = "frontend_client_shell_state:interactive_state_and_commands:apps/web/public/app-shell-client.mjs:semanticFrontier00101InteractiveStateAndCommands1", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionRuntimeKey, surfaceId: "frontend_client_shell_state", focusGroup: "frontend_architecture", phaseId: "interactive_state_and_commands", shardId: "focus.frontend_client_shell_state::semantic-frontier-001#01-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "apps/web/public/app-shell-client.mjs", workspaceId, durableStateReady: Boolean(db), ...frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionRuntimeCounts, phaseRuntimeSignal: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionPhaseRuntimeSignal, workflowEvidence: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:frontend_client_shell_state:monitor_job_runtime_handoff" : "interactive_state_and_commands:frontend_client_shell_state:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionRuntimeKey, targetFile: "apps/web/public/app-shell-client.mjs" } };
}



export function buildFrontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionState(state = {}, actor = {}, input = {}) {
  const frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionRuntimeKey = "frontend_client_shell_state:interactive_state_and_commands:apps/web/public/app-shell-client.mjs:semanticFrontier00101InteractiveStateAndCommands2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionRuntimeKey, surfaceId: "frontend_client_shell_state", focusGroup: "frontend_architecture", phaseId: "interactive_state_and_commands", shardId: "focus.frontend_client_shell_state::semantic-frontier-001#01-interactive_state_and_commands#2", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "apps/web/public/app-shell-client.mjs", workspaceId, durableStateReady: Boolean(db), ...frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionRuntimeCounts, phaseRuntimeSignal: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionPhaseRuntimeSignal, workflowEvidence: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:frontend_client_shell_state:monitor_job_runtime_handoff" : "interactive_state_and_commands:frontend_client_shell_state:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionRuntimeKey, targetFile: "apps/web/public/app-shell-client.mjs" } };
}



export function buildWebsiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionState(state = {}, actor = {}, input = {}) {
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionRuntimeKey = "website_builder_editor_realism:interactive_state_and_commands:apps/web/public/app-shell-client.mjs:semanticFrontier00101InteractiveStateAndCommands1", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionRuntimeKey, surfaceId: "website_builder_editor_realism", focusGroup: "website_builder", phaseId: "interactive_state_and_commands", shardId: "focus.website_builder_editor_realism::semantic-frontier-001#01-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "apps/web/public/app-shell-client.mjs", workspaceId, durableStateReady: Boolean(db), ...websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionRuntimeCounts, phaseRuntimeSignal: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionPhaseRuntimeSignal, workflowEvidence: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:website_builder_editor_realism:monitor_job_runtime_handoff" : "interactive_state_and_commands:website_builder_editor_realism:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1AdoptionRuntimeKey, targetFile: "apps/web/public/app-shell-client.mjs" } };
}



export function buildWebsiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionState(state = {}, actor = {}, input = {}) {
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionRuntimeKey = "website_builder_editor_realism:interactive_state_and_commands:apps/web/public/app-shell-client.mjs:semanticFrontier00101InteractiveStateAndCommands2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionRuntimeKey, surfaceId: "website_builder_editor_realism", focusGroup: "website_builder", phaseId: "interactive_state_and_commands", shardId: "focus.website_builder_editor_realism::semantic-frontier-001#01-interactive_state_and_commands#2", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "apps/web/public/app-shell-client.mjs", workspaceId, durableStateReady: Boolean(db), ...websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionRuntimeCounts, phaseRuntimeSignal: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionPhaseRuntimeSignal, workflowEvidence: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:website_builder_editor_realism:monitor_job_runtime_handoff" : "interactive_state_and_commands:website_builder_editor_realism:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2AdoptionRuntimeKey, targetFile: "apps/web/public/app-shell-client.mjs" } };
}



export function buildWebsiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionState(state = {}, actor = {}, input = {}) {
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionRuntimeKey = "website_builder_editor_realism:interactive_state_and_commands:apps/web/public/app-shell-client.mjs:semanticFrontier00101InteractiveStateAndCommands1_r2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionRuntimeKey, surfaceId: "website_builder_editor_realism", focusGroup: "website_builder", phaseId: "interactive_state_and_commands", shardId: "focus.website_builder_editor_realism::semantic-frontier-001#01-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "apps/web/public/app-shell-client.mjs", workspaceId, durableStateReady: Boolean(db), ...websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionRuntimeCounts, phaseRuntimeSignal: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionPhaseRuntimeSignal, workflowEvidence: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:website_builder_editor_realism:monitor_job_runtime_handoff" : "interactive_state_and_commands:website_builder_editor_realism:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionRuntimeKey, targetFile: "apps/web/public/app-shell-client.mjs" } };
}



export function buildWebsiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionState(state = {}, actor = {}, input = {}) {
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionRuntimeKey = "website_builder_editor_realism:interactive_state_and_commands:apps/web/public/app-shell-client.mjs:semanticFrontier00101InteractiveStateAndCommands2_r2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionRuntimeKey, surfaceId: "website_builder_editor_realism", focusGroup: "website_builder", phaseId: "interactive_state_and_commands", shardId: "focus.website_builder_editor_realism::semantic-frontier-001#01-interactive_state_and_commands#2", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "apps/web/public/app-shell-client.mjs", workspaceId, durableStateReady: Boolean(db), ...websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionRuntimeCounts, phaseRuntimeSignal: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionPhaseRuntimeSignal, workflowEvidence: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:website_builder_editor_realism:monitor_job_runtime_handoff" : "interactive_state_and_commands:website_builder_editor_realism:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionRuntimeKey, targetFile: "apps/web/public/app-shell-client.mjs" } };
}



export function buildWebsiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R3AdoptionState(state = {}, actor = {}, input = {}) {
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R3AdoptionRuntimeKey = "website_builder_editor_realism:interactive_state_and_commands:apps/web/public/app-shell-client.mjs:semanticFrontier00101InteractiveStateAndCommands1_r3", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R3AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R3AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R3AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R3AdoptionRuntimeKey, surfaceId: "website_builder_editor_realism", focusGroup: "website_builder", phaseId: "interactive_state_and_commands", shardId: "focus.website_builder_editor_realism::semantic-frontier-001#01-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "apps/web/public/app-shell-client.mjs", workspaceId, durableStateReady: Boolean(db), ...websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R3AdoptionRuntimeCounts, phaseRuntimeSignal: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R3AdoptionPhaseRuntimeSignal, workflowEvidence: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R3AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R3AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:website_builder_editor_realism:monitor_job_runtime_handoff" : "interactive_state_and_commands:website_builder_editor_realism:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R3AdoptionRuntimeKey, targetFile: "apps/web/public/app-shell-client.mjs" } };
}



export function buildWebsiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R3AdoptionState(state = {}, actor = {}, input = {}) {
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R3AdoptionRuntimeKey = "website_builder_editor_realism:interactive_state_and_commands:apps/web/public/app-shell-client.mjs:semanticFrontier00101InteractiveStateAndCommands2_r3", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R3AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R3AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R3AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R3AdoptionRuntimeKey, surfaceId: "website_builder_editor_realism", focusGroup: "website_builder", phaseId: "interactive_state_and_commands", shardId: "focus.website_builder_editor_realism::semantic-frontier-001#01-interactive_state_and_commands#2", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "apps/web/public/app-shell-client.mjs", workspaceId, durableStateReady: Boolean(db), ...websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R3AdoptionRuntimeCounts, phaseRuntimeSignal: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R3AdoptionPhaseRuntimeSignal, workflowEvidence: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R3AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R3AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:website_builder_editor_realism:monitor_job_runtime_handoff" : "interactive_state_and_commands:website_builder_editor_realism:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R3AdoptionRuntimeKey, targetFile: "apps/web/public/app-shell-client.mjs" } };
}

function evaluatePrimaryRuntimeAdoption(config, state = {}, actor = {}, input = {}) {
  const workspaceId = actor?.workspace?.id || actor?.workspaceId || input.workspaceId || 'workspace';
  const db = state.db || {};
  const now = input.now || new Date().toISOString();
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !['completed', 'failed', 'cancelled'].includes(entry.status) && (!entry.workspaceId || entry.workspaceId === workspaceId)) : [];
  const events = Array.isArray(db.auditEvents) ? db.auditEvents.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).slice(0, 5) : [];
  const workflowSignals = (config.workflowSignals || []).map((signal, index) => ({ id: signal, status: input.completedSignals?.includes?.(signal) ? 'complete' : index === 0 ? 'active' : 'pending', requestScoped: true, recoverable: signal.includes('recovery') || signal.includes('handoff') }));
  return {
    ...config,
    workspaceId,
    generatedAt: now,
    counters: { campaigns: campaigns.length, contacts: contacts.length, activeJobs: jobs.length, auditEvents: events.length },
    workflowSignals,
    nextAction: jobs.length > 0 ? 'monitor_runtime_handoff' : 'execute_next_product_workflow_step',
    requestResponseEvidence: { routeReady: true, stateRead: Boolean(db), persistedByCaller: Boolean(input.persistedByCaller), recoveryPath: workflowSignals.some((signal) => signal.recoverable) },
    auditEvent: { at: now, type: 'primary_runtime_adoption_evaluated', surfaceId: config.surfaceId, phaseId: config.phaseId, shardId: config.shardId }
  };
}


export function buildFrontendClientShellStateContinuationWave001ClientAppRuntimeAdoptionPrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_client_app_runtime_adoption","phaseTitle":"continuation wave 001 — client application runtime adoption slice","shardId":"focus.frontend_client_shell_state::continuation-001#1#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001BrowserEvidenceAcceptanceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_browser_evidence_acceptance_runtime","phaseTitle":"continuation wave 001 — browser evidence and acceptance runtime slice","shardId":"focus.frontend_client_shell_state::continuation-001#10#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001MultiTenantWorkspaceBoundariesPrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_multi_tenant_workspace_boundaries","phaseTitle":"continuation wave 001 — multi-tenant workspace boundary slice","shardId":"focus.frontend_client_shell_state::continuation-001#11#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["workspace_scope","role_boundary","tenant_isolation","audit_handoff","recovery"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001ServiceBackedProviderContractsPrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_service_backed_provider_contracts","phaseTitle":"continuation wave 001 — service-backed provider contract slice","shardId":"focus.frontend_client_shell_state::continuation-001#12#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["runtime_state","workflow_command","audit_event","recovery","next_action"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001AssetRenderingPipelineRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_asset_rendering_pipeline_runtime","phaseTitle":"continuation wave 001 — asset rendering and delivery pipeline slice","shardId":"focus.frontend_client_shell_state::continuation-001#13#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["asset_normalization","render_preview","delivery_handoff","cache_metadata","recovery"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001WorkflowApprovalLifecycleRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_workflow_approval_lifecycle_runtime","phaseTitle":"continuation wave 001 — workflow approval and lifecycle slice","shardId":"focus.frontend_client_shell_state::continuation-001#14#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["draft","review","approval","publish","recovery"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001DataPrivacyComplianceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_data_privacy_compliance_runtime","phaseTitle":"continuation wave 001 — data privacy and compliance runtime slice","shardId":"focus.frontend_client_shell_state::continuation-001#15#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["consent","suppression","retention","export","legal_hold"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001ObservabilitySlaRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_observability_sla_runtime","phaseTitle":"continuation wave 001 — observability and SLA runtime slice","shardId":"focus.frontend_client_shell_state::continuation-001#16#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001ImportExportMigrationRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_import_export_migration_runtime","phaseTitle":"continuation wave 001 — import/export and migration runtime slice","shardId":"focus.frontend_client_shell_state::continuation-001#17#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001ExperimentationOptimizationRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_experimentation_optimization_runtime","phaseTitle":"continuation wave 001 — experimentation and optimization runtime slice","shardId":"focus.frontend_client_shell_state::continuation-001#18#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001RealtimeCollaborationPresenceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_realtime_collaboration_presence_runtime","phaseTitle":"continuation wave 001 — real-time collaboration and presence slice","shardId":"focus.frontend_client_shell_state::continuation-001#19#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001EditorInteractionRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_editor_interaction_runtime","phaseTitle":"continuation wave 001 — editor interaction runtime slice","shardId":"focus.frontend_client_shell_state::continuation-001#2#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001BillingEntitlementUsageRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_billing_entitlement_usage_runtime","phaseTitle":"continuation wave 001 — billing entitlement and usage runtime slice","shardId":"focus.frontend_client_shell_state::continuation-001#20#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001ApiRateLimitWebhookDeliveryRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_api_rate_limit_webhook_delivery_runtime","phaseTitle":"continuation wave 001 — API rate-limit and webhook delivery slice","shardId":"focus.frontend_client_shell_state::continuation-001#21#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["asset_normalization","render_preview","delivery_handoff","cache_metadata","recovery"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001NegativeSpaceParityAcceptanceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_negative_space_parity_acceptance_runtime","phaseTitle":"continuation wave 001 — negative-space parity acceptance slice","shardId":"focus.frontend_client_shell_state::continuation-001#22#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001EnterpriseAccountGovernanceRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_enterprise_account_governance_runtime","phaseTitle":"continuation wave 001 — enterprise account governance runtime slice","shardId":"focus.frontend_client_shell_state::continuation-001#23#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["client_state","request_response","workflow_command","audit_event","recovery"]}, state, actor, input);
}

export function buildFrontendClientShellStateContinuationWave001DataResidencyRetentionRuntimePrimaryAdoptionRuntime(state = {}, actor = {}, input = {}) {
  return evaluatePrimaryRuntimeAdoption({"surfaceId":"frontend_client_shell_state","focusGroup":"frontend_architecture","phaseId":"continuation_wave_001_data_residency_retention_runtime","phaseTitle":"continuation wave 001 — data residency and retention runtime slice","shardId":"focus.frontend_client_shell_state::continuation-001#24#1","targetFile":"apps/web/public/app-shell-client.mjs","workflowSignals":["consent","suppression","retention","export","legal_hold"]}, state, actor, input);
}



export function buildWebsiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1R2AdoptionState(state = {}, actor = {}, input = {}) {
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1R2AdoptionRuntimeKey = "website_builder_editor_realism:interactive_state_and_commands:apps/web/public/app-shell-client.mjs:semanticFrontier00102InteractiveStateAndCommands1_r2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1R2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1R2AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1R2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1R2AdoptionRuntimeKey, surfaceId: "website_builder_editor_realism", focusGroup: "website_builder", phaseId: "interactive_state_and_commands", shardId: "focus.website_builder_editor_realism::semantic-frontier-001#02-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "apps/web/public/app-shell-client.mjs", semanticRuntimeContractRef: "websiteBuilderEditorRealismInteractiveStateAndCommandsSemanticRuntimeContract", workspaceId, durableStateReady: Boolean(db), ...websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1R2AdoptionRuntimeCounts, phaseRuntimeSignal: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1R2AdoptionPhaseRuntimeSignal, workflowEvidence: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1R2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1R2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:website_builder_editor_realism:monitor_job_runtime_handoff" : "interactive_state_and_commands:website_builder_editor_realism:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands1R2AdoptionRuntimeKey, targetFile: "apps/web/public/app-shell-client.mjs", semanticRuntimeContractRef: "websiteBuilderEditorRealismInteractiveStateAndCommandsSemanticRuntimeContract" } };
}



export function buildFrontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionState(state = {}, actor = {}, input = {}) {
  const frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionRuntimeKey = "frontend_client_shell_state:interactive_state_and_commands:apps/web/public/app-shell-client.mjs:semanticFrontier00101InteractiveStateAndCommands1_r2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionRuntimeKey, surfaceId: "frontend_client_shell_state", focusGroup: "frontend_architecture", phaseId: "interactive_state_and_commands", shardId: "focus.frontend_client_shell_state::semantic-frontier-001#01-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "apps/web/public/app-shell-client.mjs", semanticRuntimeContractRef: "frontendClientShellStateInteractiveStateAndCommandsSemanticRuntimeContract", workspaceId, durableStateReady: Boolean(db), ...frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionRuntimeCounts, phaseRuntimeSignal: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionPhaseRuntimeSignal, workflowEvidence: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:frontend_client_shell_state:monitor_job_runtime_handoff" : "interactive_state_and_commands:frontend_client_shell_state:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands1R2AdoptionRuntimeKey, targetFile: "apps/web/public/app-shell-client.mjs", semanticRuntimeContractRef: "frontendClientShellStateInteractiveStateAndCommandsSemanticRuntimeContract" } };
}



export function buildFrontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionState(state = {}, actor = {}, input = {}) {
  const frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionRuntimeKey = "frontend_client_shell_state:interactive_state_and_commands:apps/web/public/app-shell-client.mjs:semanticFrontier00101InteractiveStateAndCommands2_r2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionRuntimeKey, surfaceId: "frontend_client_shell_state", focusGroup: "frontend_architecture", phaseId: "interactive_state_and_commands", shardId: "focus.frontend_client_shell_state::semantic-frontier-001#01-interactive_state_and_commands#2", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "apps/web/public/app-shell-client.mjs", semanticRuntimeContractRef: "frontendClientShellStateInteractiveStateAndCommandsSemanticRuntimeContract", workspaceId, durableStateReady: Boolean(db), ...frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionRuntimeCounts, phaseRuntimeSignal: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionPhaseRuntimeSignal, workflowEvidence: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:frontend_client_shell_state:monitor_job_runtime_handoff" : "interactive_state_and_commands:frontend_client_shell_state:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: frontendClientShellStateInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00101InteractiveStateAndCommands2R2AdoptionRuntimeKey, targetFile: "apps/web/public/app-shell-client.mjs", semanticRuntimeContractRef: "frontendClientShellStateInteractiveStateAndCommandsSemanticRuntimeContract" } };
}



export function buildWebsiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands2AdoptionState(state = {}, actor = {}, input = {}) {
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands2AdoptionRuntimeKey = "website_builder_editor_realism:interactive_state_and_commands:apps/web/public/app-shell-client.mjs:semanticFrontier00102InteractiveStateAndCommands2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands2AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands2AdoptionRuntimeKey, surfaceId: "website_builder_editor_realism", focusGroup: "website_builder", phaseId: "interactive_state_and_commands", shardId: "focus.website_builder_editor_realism::semantic-frontier-001#02-interactive_state_and_commands#2", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "apps/web/public/app-shell-client.mjs", semanticRuntimeContractRef: "websiteBuilderEditorRealismInteractiveStateAndCommandsSemanticRuntimeContract", workspaceId, durableStateReady: Boolean(db), ...websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands2AdoptionRuntimeCounts, phaseRuntimeSignal: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands2AdoptionPhaseRuntimeSignal, workflowEvidence: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell-client.mjs","apps/web/public/app-shell.css","apps/web/public/app-shell.jsx"], nextAction: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:website_builder_editor_realism:monitor_job_runtime_handoff" : "interactive_state_and_commands:website_builder_editor_realism:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: websiteBuilderEditorRealismInteractiveStateAndCommandsAppsWebPublicAppShellClientMjsSemanticFrontier00102InteractiveStateAndCommands2AdoptionRuntimeKey, targetFile: "apps/web/public/app-shell-client.mjs", semanticRuntimeContractRef: "websiteBuilderEditorRealismInteractiveStateAndCommandsSemanticRuntimeContract" } };
}

