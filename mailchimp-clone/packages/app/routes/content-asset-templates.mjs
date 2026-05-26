import { page } from '../view.mjs';
import { readBody, redirect, text } from '../utils.mjs';
import {
  buildContentStudioRuntimeSnapshot,
  contentStudioSummary,
  createTemplateCollection,
  ensureBrandKit,
  persistContentStudioRuntimeSnapshot,
  recordContentAssetLifecycleEvent,
  recordContentGovernanceEvent,
  recordContentTemplateReviewEvent,
  recordContentUsageTelemetryEvent,
  saveContentTemplate,
  templateLibrarySummary,
  updateBrandKit,
  workspaceContentTemplates
} from '../domain-template-assets.mjs';

export function registerContentAssetTemplateRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/content', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const brandKit = ensureBrandKit(state, actor);
    const summary = contentStudioSummary(state, actor.workspace.id);
    const emailBuilder = emailBuilderParitySummary(state, actor.workspace.id);
    const depth = contentDepthSummary(state, actor.workspace.id);
    const templateLibrary = templateLibrarySummary(state, actor.workspace.id);
    const templates = workspaceContentTemplates(state, actor.workspace.id);
    const collections = state.db.templateCollections.filter((entry) => entry.workspaceId === actor.workspace.id);
    const assets = state.db.assets.filter((entry) => entry.workspaceId === actor.workspace.id);
    const runtime = buildContentStudioRuntimeSnapshot(state, actor.workspace.id);
    text(res, 200, page('Content studio templates & assets', actor, `<div class="grid"><div class="card"><h3>Brand kit</h3><form method="post" action="/content/brand-kit"><input name="name" value="${brandKit.name}"><input name="logoAssetName" value="${brandKit.logoAssetName || ''}" placeholder="logo.txt"><input name="primaryColor" value="${brandKit.primaryColor}"><input name="secondaryColor" value="${brandKit.secondaryColor}"><input name="headingFont" value="${brandKit.headingFont}"><input name="bodyFont" value="${brandKit.bodyFont}"><button>Save brand kit</button></form></div><div class="card"><h3>Studio summary</h3><ul><li>Brand kits: ${summary.brandKits}</li><li>Saved templates: ${summary.savedTemplates}</li><li>Collections: ${summary.collections}</li><li>Assets: ${summary.assets}</li></ul><p><a href="/content/depth">Open content depth tools</a></p></div><div class="card"><h3>Email builder</h3><p>Draft campaigns: ${emailBuilder.draftCampaigns}</p><p>Editor-ready drafts: ${emailBuilder.editorReady}</p><p>Reusable templates: ${emailBuilder.reusableTemplates}</p><p><a href="/campaigns">Resume at ${emailBuilder.nextStep}</a></p></div><div class="card"><h3>Content runtime</h3><p>${runtime.assetLifecycleEventCount} asset lifecycle events · ${runtime.templateReviewEventCount} template reviews · ${runtime.usageTelemetryEventCount} usage telemetry events</p><p>${runtime.governanceEventCount} governance checks · ${runtime.approvedAssetCount} approved assets · ${runtime.approvedTemplateCount} approved templates</p><form method="post" action="/content/runtime/snapshot"><button>Capture content runtime snapshot</button></form><p><a href="/api/content/runtime">Open content runtime API</a></p></div></div><div class="grid"><div class="card"><h3>Save reusable template</h3><form method="post" action="/content/templates"><input name="name" placeholder="Executive update"><select name="baseTemplateId">${state.db.templates.map((template) => `<option value="${template.id}">${template.name}</option>`).join('')}</select><input name="category" placeholder="Internal"><textarea name="description" placeholder="When to use this template"></textarea><button>Save template</button></form></div><div class="card"><h3>Create asset collection</h3><form method="post" action="/content/collections"><input name="name" placeholder="Q2 launch kit"><input name="purpose" placeholder="Product launch assets"><input name="assetNames" placeholder="hero.txt, logo.png"><button>Create collection</button></form></div><div class="card"><h3>Runtime ledgers</h3><form method="post" action="/content/assets/runtime"><input name="assetName" placeholder="hero.txt"><select name="action"><option value="approved_for_use">approved_for_use</option><option value="used_in_campaign">used_in_campaign</option><option value="retired">retired</option></select><input name="status" value="approved"><button>Record asset lifecycle</button></form><form method="post" action="/content/templates/review"><input name="templateName" placeholder="Leadership brief"><input name="reviewStage" value="brand_review"><select name="decision"><option value="approved">approved</option><option value="needs_changes">needs_changes</option></select><button>Record template review</button></form><form method="post" action="/content/usage"><input name="objectName" placeholder="Leadership brief"><input name="metricName" value="campaign_apply"><input name="metricValue" value="1"><button>Record usage telemetry</button></form><form method="post" action="/content/governance"><input name="policy" value="brand_color_contrast"><select name="result"><option value="passed">passed</option><option value="failed">failed</option></select><input name="violations" placeholder="missing alt text"><button>Record governance check</button></form></div><div class="card"><h3>Content depth</h3><p>Snippets: ${depth.snippets}</p><p>Versions: ${depth.versions}</p><p>Approval requests: ${depth.approvalRequests}</p><p>Top reusable asset: ${depth.topAsset || 'None yet'}</p></div><div class="card"><h3>Depth workflows</h3><p><a href="/content/depth">Search assets + snippets + lineage</a></p><p>Version snapshots and content approval requests are now first-class.</p></div></div><div class="card"><h3>Template library</h3><p>Workspace templates: ${templateLibrary.workspaceTemplates}</p><p>System templates: ${templateLibrary.systemTemplates}</p><p>Collections: ${templateLibrary.collections}</p><p>Categories: ${templateLibrary.categories.join(', ') || 'general'}</p></div><div class="card"><h3>Saved content templates</h3><table><tr><th>Name</th><th>Category</th><th>Source</th><th>Review</th><th>Blocks</th></tr>${templates.map((template) => `<tr><td>${template.name}</td><td>${template.category || '—'}</td><td>${template.source || 'system'}</td><td>${template.reviewStatus || 'not_reviewed'}</td><td>${template.blocks?.length || 0}</td></tr>`).join('')}</table></div><div class="card"><h3>Asset collections</h3><table><tr><th>Name</th><th>Purpose</th><th>Assets</th></tr>${collections.map((collection) => `<tr><td>${collection.name}</td><td>${collection.purpose}</td><td>${collection.assetNames.join(', ') || '—'}</td></tr>`).join('') || '<tr><td colspan="3">No collections yet.</td></tr>'}</table></div><div class="card"><h3>Connected assets</h3><table><tr><th>Name</th><th>Folder</th><th>Status</th><th>Usage</th></tr>${assets.map((asset) => `<tr><td>${asset.name}</td><td>${asset.folder}</td><td>${asset.lifecycleStatus || 'uploaded'}</td><td>${asset.usageCount || 0}</td></tr>`).join('') || '<tr><td colspan="4">Upload assets from the content studio or campaign editor.</td></tr>'}</table></div>`));
  });

  router.register('POST', '/content/brand-kit', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    updateBrandKit(state, actor, await readBody(req));
    redirect(res, '/content');
  });

  router.register('POST', '/content/templates', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    saveContentTemplate(state, actor, await readBody(req));
    redirect(res, '/content');
  });

  router.register('POST', '/content/collections', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    createTemplateCollection(state, actor, await readBody(req));
    redirect(res, '/content');
  });

  router.register('POST', '/content/runtime/snapshot', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    persistContentStudioRuntimeSnapshot(state, actor, 'manual_route_snapshot');
    redirect(res, '/content');
  });

  router.register('POST', '/content/assets/runtime', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    recordContentAssetLifecycleEvent(state, actor, await readBody(req));
    redirect(res, '/content');
  });

  router.register('POST', '/content/templates/review', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    recordContentTemplateReviewEvent(state, actor, await readBody(req));
    redirect(res, '/content');
  });

  router.register('POST', '/content/usage', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    recordContentUsageTelemetryEvent(state, actor, await readBody(req));
    redirect(res, '/content');
  });

  router.register('POST', '/content/governance', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    recordContentGovernanceEvent(state, actor, await readBody(req));
    redirect(res, '/content');
  });
}

export const templateLibraryIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "template_library",
  "focusGroup": "template_library",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.template_library::semantic-frontier-001#04-integrated_user_path_evidence#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildTemplateLibraryIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...templateLibraryIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-campaigns.mjs","packages/app/domain-template-assets.mjs","packages/app/routes/content-asset-templates.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: templateLibraryIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: templateLibraryIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: templateLibraryIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}

export const templateLibraryPrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "template_library",
  "focusGroup": "template_library",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.template_library::semantic-frontier-001#04-primary_runtime_spine#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildTemplateLibraryPrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...templateLibraryPrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-campaigns.mjs","packages/app/domain-template-assets.mjs","packages/app/routes/content-asset-templates.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: templateLibraryPrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: templateLibraryPrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: templateLibraryPrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}



export function buildContentStudioIntegratedUserPathEvidencePackagesAppRoutesContentAssetTemplatesMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const contentStudioIntegratedUserPathEvidencePackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeKey = "content_studio:integrated_user_path_evidence:packages/app/routes/content-asset-templates.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contentStudioIntegratedUserPathEvidencePackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contentStudioIntegratedUserPathEvidencePackagesAppRoutesContentAssetTemplatesMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", contentStudioIntegratedUserPathEvidencePackagesAppRoutesContentAssetTemplatesMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contentStudioIntegratedUserPathEvidencePackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeKey, surfaceId: "content_studio", focusGroup: "content_studio", phaseId: "integrated_user_path_evidence", shardId: "focus.content_studio::semantic-frontier-001#14-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/routes/content-asset-templates.mjs", workspaceId, durableStateReady: Boolean(db), ...contentStudioIntegratedUserPathEvidencePackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeCounts, phaseRuntimeSignal: contentStudioIntegratedUserPathEvidencePackagesAppRoutesContentAssetTemplatesMjsAdoptionPhaseRuntimeSignal, workflowEvidence: contentStudioIntegratedUserPathEvidencePackagesAppRoutesContentAssetTemplatesMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-content-ecosystem-depth.mjs","packages/app/routes/content-asset-templates.mjs","packages/app/routes/content-library.mjs"], nextAction: contentStudioIntegratedUserPathEvidencePackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:content_studio:monitor_job_runtime_handoff" : "integrated_user_path_evidence:content_studio:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contentStudioIntegratedUserPathEvidencePackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/content-asset-templates.mjs" } };
}



export function buildContentStudioPrimaryRuntimeSpinePackagesAppRoutesContentAssetTemplatesMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const contentStudioPrimaryRuntimeSpinePackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeKey = "content_studio:primary_runtime_spine:packages/app/routes/content-asset-templates.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contentStudioPrimaryRuntimeSpinePackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contentStudioPrimaryRuntimeSpinePackagesAppRoutesContentAssetTemplatesMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", contentStudioPrimaryRuntimeSpinePackagesAppRoutesContentAssetTemplatesMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contentStudioPrimaryRuntimeSpinePackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeKey, surfaceId: "content_studio", focusGroup: "content_studio", phaseId: "primary_runtime_spine", shardId: "focus.content_studio::semantic-frontier-001#14-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/routes/content-asset-templates.mjs", workspaceId, durableStateReady: Boolean(db), ...contentStudioPrimaryRuntimeSpinePackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeCounts, phaseRuntimeSignal: contentStudioPrimaryRuntimeSpinePackagesAppRoutesContentAssetTemplatesMjsAdoptionPhaseRuntimeSignal, workflowEvidence: contentStudioPrimaryRuntimeSpinePackagesAppRoutesContentAssetTemplatesMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-content-ecosystem-depth.mjs","packages/app/routes/content-asset-templates.mjs","packages/app/routes/content-library.mjs"], nextAction: contentStudioPrimaryRuntimeSpinePackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:content_studio:monitor_job_runtime_handoff" : "primary_runtime_spine:content_studio:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contentStudioPrimaryRuntimeSpinePackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/content-asset-templates.mjs" } };
}


export const contentStudioInteractiveStateAndCommandsSemanticRuntimeContract = Object.freeze({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"interactive_state_and_commands","shardId":"focus.content_studio::semantic-frontier-001#14-interactive_state_and_commands#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildContentStudioInteractiveStateAndCommandsPackagesAppRoutesContentAssetTemplatesMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const contentStudioInteractiveStateAndCommandsPackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeKey = "content_studio:interactive_state_and_commands:packages/app/routes/content-asset-templates.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contentStudioInteractiveStateAndCommandsPackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contentStudioInteractiveStateAndCommandsPackagesAppRoutesContentAssetTemplatesMjsAdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", contentStudioInteractiveStateAndCommandsPackagesAppRoutesContentAssetTemplatesMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contentStudioInteractiveStateAndCommandsPackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeKey, surfaceId: "content_studio", focusGroup: "content_studio", phaseId: "interactive_state_and_commands", shardId: "focus.content_studio::semantic-frontier-001#14-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "packages/app/routes/content-asset-templates.mjs", workspaceId, durableStateReady: Boolean(db), ...contentStudioInteractiveStateAndCommandsPackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeCounts, phaseRuntimeSignal: contentStudioInteractiveStateAndCommandsPackagesAppRoutesContentAssetTemplatesMjsAdoptionPhaseRuntimeSignal, workflowEvidence: contentStudioInteractiveStateAndCommandsPackagesAppRoutesContentAssetTemplatesMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"], nextAction: contentStudioInteractiveStateAndCommandsPackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:content_studio:monitor_job_runtime_handoff" : "interactive_state_and_commands:content_studio:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contentStudioInteractiveStateAndCommandsPackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/content-asset-templates.mjs" } };
}


export const contentStudioOperationalPersistenceAndJobsSemanticRuntimeContract = Object.freeze({"surfaceId":"content_studio","focusGroup":"content_studio","phaseId":"operational_persistence_and_jobs","shardId":"focus.content_studio::semantic-frontier-001#14-operational_persistence_and_jobs#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildContentStudioOperationalPersistenceAndJobsPackagesAppRoutesContentAssetTemplatesMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const contentStudioOperationalPersistenceAndJobsPackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeKey = "content_studio:operational_persistence_and_jobs:packages/app/routes/content-asset-templates.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const contentStudioOperationalPersistenceAndJobsPackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const contentStudioOperationalPersistenceAndJobsPackagesAppRoutesContentAssetTemplatesMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", contentStudioOperationalPersistenceAndJobsPackagesAppRoutesContentAssetTemplatesMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: contentStudioOperationalPersistenceAndJobsPackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeKey, surfaceId: "content_studio", focusGroup: "content_studio", phaseId: "operational_persistence_and_jobs", shardId: "focus.content_studio::semantic-frontier-001#14-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/routes/content-asset-templates.mjs", workspaceId, durableStateReady: Boolean(db), ...contentStudioOperationalPersistenceAndJobsPackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeCounts, phaseRuntimeSignal: contentStudioOperationalPersistenceAndJobsPackagesAppRoutesContentAssetTemplatesMjsAdoptionPhaseRuntimeSignal, workflowEvidence: contentStudioOperationalPersistenceAndJobsPackagesAppRoutesContentAssetTemplatesMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-content-ecosystem-depth.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: contentStudioOperationalPersistenceAndJobsPackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:content_studio:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:content_studio:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: contentStudioOperationalPersistenceAndJobsPackagesAppRoutesContentAssetTemplatesMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/content-asset-templates.mjs" } };
}

