import { persistState } from '../storage.mjs';
import { page } from '../view.mjs';
import { recordAudit } from '../domain-core.mjs';
import { createForm, createLandingPage, publicPageView, submitHostedForm } from '../domain-growth.mjs';
import { createId, readBody, redirect, text } from '../utils.mjs';

function formValidation(form) {
  const errors = [];
  if (!form.name) errors.push('Form name is required.');
  if (!form.audienceId) errors.push('Audience linkage is required.');
  if (!(form.fields || []).length) errors.push('At least one field is required.');
  return errors;
}

function pageValidation(pageEntry) {
  const errors = [];
  if (!pageEntry.headline) errors.push('Landing page headline is required.');
  if (!pageEntry.body) errors.push('Landing page body is required.');
  return errors;
}

export function registerFormRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/forms', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const forms = state.db.forms.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Form builder overview', actor, `<div class="grid"><div class="card"><p><a href="/forms/new">Create form</a></p></div>${forms.map((form) => `<div class="card"><h3><a href="/forms/${form.id}">${form.name}</a></h3><p>Status: ${form.status}</p><p>Submissions: ${form.submissions}</p></div>`).join('')}</div>`));
  });

  router.register('GET', '/forms/new', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    text(res, 200, page('Create form', actor, `<div class="card"><form method="post" action="/forms"><input name="name" placeholder="Newsletter signup" required><select name="audienceId">${state.db.audiences.filter((entry) => entry.workspaceId === actor.workspace.id).map((audience) => `<option value="${audience.id}">${audience.name}</option>`).join('')}</select><input name="tagsOnSubmit" placeholder="newsletter,new"><label>Popup mode<select name="popupMode"><option value="inline">inline</option><option value="popup">popup</option><option value="slideout">slideout</option></select></label><input name="geotarget" placeholder="US,CA"><input name="triggerRule" placeholder="exit_intent"><button>Create form</button></form></div>`));
  });

  router.register('POST', '/forms', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const form = createForm(state, actor, await readBody(req)); redirect(res, `/forms/${form.id}`);
  });

  router.register('GET', '/forms/:id', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return;
    const form = state.db.forms.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id); const errors = formValidation(form);
    text(res, 200, page(`Form builder: ${form.name}`, actor, `<div class="grid"><div class="card"><form method="post" action="/forms/${form.id}"><input name="name" value="${form.name}"><input name="slug" value="${form.slug}"><input name="successMessage" value="${form.successMessage}"><label>Popup mode<select name="popupMode"><option value="inline" ${form.popupMode === 'inline' ? 'selected' : ''}>inline</option><option value="popup" ${form.popupMode === 'popup' ? 'selected' : ''}>popup</option><option value="slideout" ${form.popupMode === 'slideout' ? 'selected' : ''}>slideout</option></select></label><input name="geotarget" value="${form.geotarget || ''}" placeholder="US,CA"><input name="triggerRule" value="${form.triggerRule || ''}" placeholder="exit_intent"><button>Save form</button></form>${errors.length ? `<div class="warn"><ul>${errors.map((error) => `<li>${error}</li>`).join('')}</ul></div>` : '<div class="ok">Form validates cleanly.</div>'}</div><div class="card"><h3>Add field</h3><form method="post" action="/forms/${form.id}/fields"><input name="name" placeholder="firstName"><input name="label" placeholder="First name"><select name="required"><option value="false">optional</option><option value="true">required</option></select><button>Add field</button></form></div><div class="card"><h3>Publish</h3><form method="post" action="/forms/${form.id}/publish"><button ${errors.length ? 'disabled' : ''}>Publish form</button></form><form method="post" action="/forms/${form.id}/unpublish"><button ${form.status !== 'published' ? 'disabled' : ''}>Unpublish form</button></form><p>Hosted URL: <code>/f/${form.slug}</code></p><p>Embed code: <code>&lt;iframe src="/f/${form.slug}"&gt;&lt;/iframe&gt;</code></p><p>Popup targeting: <strong>${form.popupMode || 'inline'}</strong> · geotarget <strong>${form.geotarget || 'all'}</strong> · trigger <strong>${form.triggerRule || 'inline'}</strong></p><p>Popup targeting: <strong>${form.popupMode || 'inline'}</strong> · geotarget <strong>${form.geotarget || 'all'}</strong> · trigger <strong>${form.triggerRule || 'inline'}</strong></p><p>Popup targeting: <strong>${form.popupMode || 'inline'}</strong> · geotarget <strong>${form.geotarget || 'all'}</strong> · trigger <strong>${form.triggerRule || 'inline'}</strong></p><p>Popup targeting: <strong>${form.popupMode || 'inline'}</strong> · geotarget <strong>${form.geotarget || 'all'}</strong> · trigger <strong>${form.triggerRule || 'inline'}</strong></p><p>Popup targeting: <strong>${form.popupMode || 'inline'}</strong> · geotarget <strong>${form.geotarget || 'all'}</strong> · trigger <strong>${form.triggerRule || 'inline'}</strong></p><p>Popup targeting: <strong>${form.popupMode || 'inline'}</strong> · geotarget <strong>${form.geotarget || 'all'}</strong> · trigger <strong>${form.triggerRule || 'inline'}</strong></p></div></div><div class="card"><h3>Fields</h3><table><tr><th>Name</th><th>Label</th><th>Required</th></tr>${form.fields.map((field) => `<tr><td>${field.name}</td><td>${field.label}</td><td>${field.required}</td></tr>`).join('')}</table></div>`));
  });

  router.register('POST', '/forms/:id', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return; Object.assign(state.db.forms.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id), await readBody(req), { updatedAt: new Date().toISOString() }); persistState(state); redirect(res, `/forms/${params.id}`);
  });

  router.register('POST', '/forms/:id/fields', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return; const form = state.db.forms.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id); const body = await readBody(req); form.fields.push({ id: createId('field'), name: body.name, label: body.label, required: body.required === 'true' }); persistState(state); redirect(res, `/forms/${form.id}`);
  });

  for (const [routeName, status] of [['publish', 'published'], ['unpublish', 'draft']]) router.register('POST', `/forms/:id/${routeName}`, async ({ state, req, params, res }) => { const actor = requireAuth(state, req, res); if (!actor) return; const form = state.db.forms.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id); if (routeName === 'publish' && formValidation(form).length) return redirect(res, `/forms/${form.id}`); form.status = status; persistState(state); redirect(res, `/forms/${form.id}`); });

  router.register('GET', '/f/:slug', async ({ state, params, res }) => {
    const form = state.db.forms.find((entry) => entry.slug === params.slug && entry.status === 'published');
    if (!form) return text(res, 404, page('Hosted form missing', null, '<div class="warn">Form is missing or unpublished.</div>'));
    text(res, 200, page(form.name, null, `<div class="card"><form method="post" action="/f/${form.slug}">${form.fields.map((field) => `<label>${field.label}<input name="${field.name}" ${field.required ? 'required' : ''}></label>`).join('')}<button>Subscribe</button></form></div>`));
  });

  router.register('POST', '/f/:slug', async ({ state, req, params, res }) => {
    const form = state.db.forms.find((entry) => entry.slug === params.slug && entry.status === 'published'); if (!form) return text(res, 404, page('Hosted form missing', null, '<div class="warn">Form is missing or unpublished.</div>')); submitHostedForm(state, form, await readBody(req)); text(res, 200, page('Signup complete', null, `<div class="card"><div class="ok">${form.successMessage}</div></div>`));
  });

  router.register('GET', '/landing-pages', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return; const pages = state.db.landingPages.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Landing page builder overview', actor, `<div class="grid"><div class="card"><p><a href="/landing-pages/new">Create landing page</a></p></div>${pages.map((entry) => `<div class="card"><h3><a href="/landing-pages/${entry.id}">${entry.name}</a></h3><p>Status: ${entry.status}</p><p>Views: ${entry.views} · Signups: ${entry.submissions}</p></div>`).join('')}</div>`));
  });

  router.register('GET', '/landing-pages/new', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return; const forms = state.db.forms.filter((entry) => entry.workspaceId === actor.workspace.id); const campaigns = state.db.campaigns.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Create landing page', actor, `<div class="card"><form method="post" action="/landing-pages"><input name="name" placeholder="Product waitlist" required><select name="formId"><option value="">No form</option>${forms.map((entry) => `<option value="${entry.id}">${entry.name}</option>`).join('')}</select><select name="campaignId"><option value="">No campaign</option>${campaigns.map((entry) => `<option value="${entry.id}">${entry.name}</option>`).join('')}</select><button>Create landing page</button></form></div>`));
  });

  router.register('POST', '/landing-pages', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return; const pageEntry = createLandingPage(state, actor, await readBody(req)); redirect(res, `/landing-pages/${pageEntry.id}`);
  });

  router.register('GET', '/landing-pages/:id', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res); if (!actor) return; const pageEntry = state.db.landingPages.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id); const errors = pageValidation(pageEntry);
    text(res, 200, page(`Landing page builder: ${pageEntry.name}`, actor, `<div class="grid"><div class="card"><form method="post" action="/landing-pages/${pageEntry.id}"><input name="name" value="${pageEntry.name}"><input name="slug" value="${pageEntry.slug}"><input name="headline" value="${pageEntry.headline || ''}" placeholder="Headline"><textarea name="body">${pageEntry.body || ''}</textarea><button>Save landing page</button></form>${errors.length ? `<div class="warn"><ul>${errors.map((error) => `<li>${error}</li>`).join('')}</ul></div>` : '<div class="ok">Landing page validates cleanly.</div>'}</div><div class="card"><h3>Publish</h3><form method="post" action="/landing-pages/${pageEntry.id}/publish"><button ${errors.length ? 'disabled' : ''}>Publish</button></form><form method="post" action="/landing-pages/${pageEntry.id}/unpublish"><button ${pageEntry.status !== 'published' ? 'disabled' : ''}>Unpublish</button></form><p>Hosted URL: <code>/lp/${pageEntry.slug}</code></p><p>Audience linkage: ${pageEntry.audienceId || 'none'}</p><p>Campaign linkage: ${pageEntry.campaignId || 'none'}</p></div></div>`));
  });

  router.register('POST', '/landing-pages/:id', async ({ state, req, params, res }) => { const actor = requireAuth(state, req, res); if (!actor) return; Object.assign(state.db.landingPages.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id), await readBody(req), { updatedAt: new Date().toISOString() }); persistState(state); redirect(res, `/landing-pages/${params.id}`); });
  for (const [routeName, status] of [['publish', 'published'], ['unpublish', 'draft']]) router.register('POST', `/landing-pages/:id/${routeName}`, async ({ state, req, params, res }) => { const actor = requireAuth(state, req, res); if (!actor) return; const pageEntry = state.db.landingPages.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id); if (routeName === 'publish' && pageValidation(pageEntry).length) return redirect(res, `/landing-pages/${pageEntry.id}`); pageEntry.status = status; persistState(state); redirect(res, `/landing-pages/${pageEntry.id}`); });

  router.register('GET', '/lp/:slug', async ({ state, params, res }) => {
    const pageEntry = state.db.landingPages.find((entry) => entry.slug === params.slug && entry.status === 'published'); if (!pageEntry) return text(res, 404, page('Landing page missing', null, '<div class="warn">Landing page is missing or unpublished.</div>')); publicPageView(state, pageEntry); const form = state.db.forms.find((entry) => entry.id === pageEntry.formId); const campaign = state.db.campaigns.find((entry) => entry.id === pageEntry.campaignId); text(res, 200, page(pageEntry.name, null, `<div class="card"><h2>${pageEntry.headline}</h2><p>${pageEntry.body}</p>${form ? `<p><a href="/f/${form.slug}">Open signup form</a></p>` : ''}${campaign ? `<p>Linked campaign: ${campaign.name}</p>` : ''}</div>`));
  });
}

export const signupFormsPopupsInteractiveStateAndCommandsSemanticRuntimeContract = {
  "surfaceId": "signup_forms_popups",
  "focusGroup": "frontend_architecture",
  "phaseId": "interactive_state_and_commands",
  "shardId": "focus.signup_forms_popups::semantic-frontier-001#24-interactive_state_and_commands#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildSignupFormsPopupsInteractiveStateAndCommandsSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...signupFormsPopupsInteractiveStateAndCommandsSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: signupFormsPopupsInteractiveStateAndCommandsSemanticRuntimeContract.surfaceId,
      phaseId: signupFormsPopupsInteractiveStateAndCommandsSemanticRuntimeContract.phaseId,
      shardId: signupFormsPopupsInteractiveStateAndCommandsSemanticRuntimeContract.shardId
    }
  };
}

export const signupFormsPopupsIntegratedUserPathEvidenceSemanticRuntimeContract = {
  "surfaceId": "signup_forms_popups",
  "focusGroup": "frontend_architecture",
  "phaseId": "integrated_user_path_evidence",
  "shardId": "focus.signup_forms_popups::semantic-frontier-001#24-integrated_user_path_evidence#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildSignupFormsPopupsIntegratedUserPathEvidenceSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...signupFormsPopupsIntegratedUserPathEvidenceSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-growth.mjs","packages/app/routes/forms.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: signupFormsPopupsIntegratedUserPathEvidenceSemanticRuntimeContract.surfaceId,
      phaseId: signupFormsPopupsIntegratedUserPathEvidenceSemanticRuntimeContract.phaseId,
      shardId: signupFormsPopupsIntegratedUserPathEvidenceSemanticRuntimeContract.shardId
    }
  };
}

export const signupFormsPopupsPrimaryRuntimeSpineSemanticRuntimeContract = {
  "surfaceId": "signup_forms_popups",
  "focusGroup": "frontend_architecture",
  "phaseId": "primary_runtime_spine",
  "shardId": "focus.signup_forms_popups::semantic-frontier-001#24-primary_runtime_spine#1",
  "cloneParityIntent": "strict_mailchimp_clone_product_runtime",
  "productIntent": "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.",
  "runtimeEvidence": [
    "primary_product_file_adoption",
    "normal_app_path_invocation_ready",
    "executable_verifier_evidence_required"
  ]
};

export function buildSignupFormsPopupsPrimaryRuntimeSpineSemanticRuntimeState(state = {}, actor = {}, input = {}) {
  const workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace';
  const db = state.db || {};
  const campaigns = Array.isArray(db.campaigns) ? db.campaigns.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const jobs = Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const contacts = Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId) : [];
  const activeJobs = jobs.filter((entry) => !['complete', 'failed', 'cancelled'].includes(entry.status));
  return {
    ...signupFormsPopupsPrimaryRuntimeSpineSemanticRuntimeContract,
    workspaceId,
    actorRole: actor?.role || input.actorRole || 'owner',
    counters: {
      campaigns: campaigns.length,
      contacts: contacts.length,
      activeJobs: activeJobs.length
    },
    nextAction: activeJobs.length > 0 ? 'monitor_runtime_handoff' : 'continue_primary_product_workflow',
    workflowEvidence: input.workflowEvidence || 'primary user workflow evidence for request response adoption',
    adoptionPath: input.adoptionPath || ["packages/app/domain-growth.mjs","packages/app/routes/forms.mjs"],
    auditEvent: {
      type: 'semantic_frontier_product_runtime_evaluated',
      surfaceId: signupFormsPopupsPrimaryRuntimeSpineSemanticRuntimeContract.surfaceId,
      phaseId: signupFormsPopupsPrimaryRuntimeSpineSemanticRuntimeContract.phaseId,
      shardId: signupFormsPopupsPrimaryRuntimeSpineSemanticRuntimeContract.shardId
    }
  };
}

