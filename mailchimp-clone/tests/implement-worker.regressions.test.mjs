import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IMPLEMENT_SCRIPT = path.join(ROOT, 'scripts', 'orchestrator-real-repo-clean-implement.mjs');

function mkWorkspace(relativeFiles) {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-implement-regression-'));
  for (const relPath of relativeFiles) {
    const source = path.join(ROOT, relPath);
    const target = path.join(workspacePath, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  return workspacePath;
}

function runFocusGroup(relativeFiles, focusGroup) {
  const workspacePath = mkWorkspace(relativeFiles);
  const assignmentPath = path.join(workspacePath, 'assignment.json');
  fs.writeFileSync(assignmentPath, JSON.stringify({ targetPath: workspacePath, issue: { inputs: { focusGroup } } }, null, 2));
  const result = spawnSync(process.execPath, [IMPLEMENT_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40
  });
  assert.equal(result.status, 0, `focusGroup ${focusGroup} should succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return { workspacePath, result };
}

function runAssignment(relativeFiles, assignment) {
  const workspacePath = mkWorkspace(relativeFiles);
  const assignmentPath = path.join(workspacePath, 'assignment.json');
  fs.writeFileSync(assignmentPath, JSON.stringify({ targetPath: workspacePath, ...assignment }, null, 2));
  const result = spawnSync(process.execPath, [IMPLEMENT_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40
  });
  assert.equal(result.status, 0, `assignment should succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return { workspacePath, result, output: JSON.parse(result.stdout) };
}

test('implement worker: frontend architecture keeps builder overlay non-interactive', () => {
  const { workspacePath } = runFocusGroup(['packages/app/view.mjs'], 'frontend_architecture');
  const css = fs.readFileSync(path.join(workspacePath, 'apps/web/public/app-shell.css'), 'utf8');
  assert.match(css, /\[data-builder-panel\][\s\S]*pointer-events:\s*none;/, 'builder overlay should remain non-interactive');
});

test('implement worker: strict frontend interaction parity shard emits allowed-file product diffs instead of no-op output', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/view.mjs',
    'packages/app/routes/public.mjs',
    'apps/web/server.mjs'
  ], {
    shardId: 'focus.frontend_interaction_parity#1',
    issue: { inputs: { focusGroup: 'frontend_architecture' } },
    shard: {
      id: 'focus.frontend_interaction_parity#1',
      allowedFiles: ['packages/app/view.mjs', 'packages/app/routes/public.mjs', 'apps/web/server.mjs']
    }
  });
  const view = fs.readFileSync(path.join(workspacePath, 'packages/app/view.mjs'), 'utf8');
  assert.equal(output.surfaceFocusId, 'frontend_interaction_parity');
  assert.ok(output.modifiedFiles.length >= 1, 'strict frontend parity shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => ['packages/app/view.mjs', 'packages/app/routes/public.mjs', 'apps/web/server.mjs'].includes(filePath)), 'strict frontend parity shard should stay within allowed files');
  assert.match(view, /mailclone-client-shell-config/, 'strict frontend parity shard should inject client shell config into the shared view layer');
  assert.match(view, /data-client-shell="interactive"/, 'strict frontend parity shard should mark the page shell as interactive');
});

test('implement worker: strict frontend interaction parity shards keep producing scoped diffs across sequential slices', () => {
  const workspacePath = mkWorkspace([
    'packages/app/view.mjs',
    'packages/app/routes/public.mjs',
    'apps/web/server.mjs'
  ]);
  const allowedFiles = ['packages/app/view.mjs', 'packages/app/routes/public.mjs', 'apps/web/server.mjs'];

  for (const shardId of ['focus.frontend_interaction_parity#1', 'focus.frontend_interaction_parity#2', 'focus.frontend_interaction_parity#3']) {
    const assignmentPath = path.join(workspacePath, `${shardId.replace(/[^a-z0-9#._-]+/gi, '_')}.json`);
    fs.writeFileSync(assignmentPath, JSON.stringify({
      targetPath: workspacePath,
      shardId,
      issue: { inputs: { focusGroup: 'frontend_architecture' } },
      shard: { id: shardId, allowedFiles }
    }, null, 2));
    const result = spawnSync(process.execPath, [IMPLEMENT_SCRIPT, '--assignment', assignmentPath], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 40
    });
    assert.equal(result.status, 0, `${shardId} should succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.ok(output.modifiedFiles.length >= 1, `${shardId} should still emit a scoped diff`);
  }

  const publicRoutes = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/public.mjs'), 'utf8');
  const server = fs.readFileSync(path.join(workspacePath, 'apps/web/server.mjs'), 'utf8');
  assert.match(publicRoutes, /\/static\/app-shell-manifest\.json/, 'later frontend parity shards should add the shell manifest route');
  assert.match(server, /x-mailclone-client-shell/, 'later frontend parity shards should add shell headers at the server boundary');
});

test('implement worker: strict campaign editor parity shards override stale delivery focus and emit allowed-file diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/template-variants/domain-template-variants.mjs',
    'packages/template-variants/index.mjs',
    'packages/template-approvals/domain-template-approvals.mjs',
    'packages/template-approvals/index.mjs'
  ], {
    shardId: 'focus.campaign_editor_parity#1',
    issue: { inputs: { focusGroup: 'delivery_jobs' } },
    shard: {
      id: 'focus.campaign_editor_parity#1',
      allowedFiles: [
        'packages/template-variants/domain-template-variants.mjs',
        'packages/template-variants/index.mjs',
        'packages/template-approvals/domain-template-approvals.mjs',
        'packages/template-approvals/index.mjs'
      ]
    }
  });
  const variantsDomain = fs.readFileSync(path.join(workspacePath, 'packages/template-variants/domain-template-variants.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'campaign_editor');
  assert.equal(output.surfaceFocusId, 'campaign_editor_parity');
  assert.ok(output.modifiedFiles.length >= 1, 'strict campaign editor parity shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/template-variants/domain-template-variants.mjs',
    'packages/template-variants/index.mjs',
    'packages/template-approvals/domain-template-approvals.mjs',
    'packages/template-approvals/index.mjs'
  ].includes(filePath)), 'strict campaign editor parity shard should stay within allowed files');
  assert.match(variantsDomain, /createCampaignEditorVariantCatalog/, 'strict campaign editor parity shard should add campaign editor variant helpers');
});

test('implement worker: canonical tags/groups/interests shard routes to the audience CRM handler and emits allowed-file diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/domain-audience.mjs',
    'packages/app/routes/audience.mjs'
  ], {
    shardId: 'focus.tags_groups_interests',
    issue: { inputs: { focusGroup: 'focus.tags_groups_interests' } },
    shard: {
      id: 'focus.tags_groups_interests',
      allowedFiles: [
        'packages/app/domain-audience.mjs',
        'packages/app/routes/audience.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.tags_groups_interests', surfaceIds: ['tags_groups_interests'] },
      guardrails: { allowedFiles: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'] }
    }
  });
  const audienceRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/audience.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'audience_crm');
  assert.equal(output.surfaceFocusId, 'tags_groups_interests');
  assert.ok(output.modifiedFiles.length >= 1, 'canonical tags/groups/interests shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/domain-audience.mjs',
    'packages/app/routes/audience.mjs'
  ].includes(filePath)), 'canonical tags/groups/interests shard should stay within allowed files');
  assert.match(audienceRoute, /CRM health/, 'canonical tags/groups/interests shard should add CRM health cues');
});

test('implement worker: canonical email builder shard emits allowed-file product diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/domain-campaigns.mjs',
    'packages/app/routes/content-asset-templates.mjs'
  ], {
    shardId: 'focus.email_builder',
    issue: { inputs: { focusGroup: 'focus.email_builder' } },
    shard: {
      id: 'focus.email_builder',
      allowedFiles: [
        'packages/app/domain-campaigns.mjs',
        'packages/app/routes/content-asset-templates.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.email_builder', surfaceIds: ['email_builder'] },
      guardrails: { allowedFiles: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/content-asset-templates.mjs'] }
    }
  });
  const contentRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/content-asset-templates.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'email_builder');
  assert.equal(output.surfaceFocusId, 'email_builder');
  assert.ok(output.modifiedFiles.length >= 1, 'canonical email builder shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/domain-campaigns.mjs',
    'packages/app/routes/content-asset-templates.mjs'
  ].includes(filePath)), 'canonical email builder shard should stay within allowed files');
  assert.match(contentRoute, /<h3>Email builder<\/h3>/, 'canonical email builder shard should add email builder status cues');
});

test('implement worker: canonical template library shard emits allowed-file product diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/domain-template-assets.mjs',
    'packages/app/routes/content-asset-templates.mjs'
  ], {
    shardId: 'focus.template_library',
    issue: { inputs: { focusGroup: 'focus.template_library' } },
    shard: {
      id: 'focus.template_library',
      allowedFiles: [
        'packages/app/domain-template-assets.mjs',
        'packages/app/routes/content-asset-templates.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.template_library', surfaceIds: ['template_library'] },
      guardrails: { allowedFiles: ['packages/app/domain-template-assets.mjs', 'packages/app/routes/content-asset-templates.mjs'] }
    }
  });
  const contentRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/content-asset-templates.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'template_library');
  assert.equal(output.surfaceFocusId, 'template_library');
  assert.ok(output.modifiedFiles.length >= 1, 'canonical template library shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/domain-template-assets.mjs',
    'packages/app/routes/content-asset-templates.mjs'
  ].includes(filePath)), 'canonical template library shard should stay within allowed files');
  assert.match(contentRoute, /<h3>Template library<\/h3>/, 'canonical template library shard should add template library status cues');
});

test('implement worker: canonical signup forms and popups shard emits allowed-file product diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/routes/forms.mjs',
    'packages/app/domain-growth.mjs'
  ], {
    shardId: 'focus.signup_forms_popups',
    issue: { inputs: { focusGroup: 'focus.signup_forms_popups' } },
    shard: {
      id: 'focus.signup_forms_popups',
      allowedFiles: [
        'packages/app/routes/forms.mjs',
        'packages/app/domain-growth.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.signup_forms_popups', surfaceIds: ['signup_forms_popups'] },
      guardrails: { allowedFiles: ['packages/app/routes/forms.mjs', 'packages/app/domain-growth.mjs'] }
    }
  });
  const formsRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/forms.mjs'), 'utf8');
  assert.equal(output.surfaceFocusId, 'signup_forms_popups');
  assert.ok(output.modifiedFiles.length >= 1, 'canonical signup forms shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/routes/forms.mjs',
    'packages/app/domain-growth.mjs'
  ].includes(filePath)), 'canonical signup forms shard should stay within allowed files');
  assert.match(formsRoute, /Popup mode/, 'canonical signup forms shard should add popup controls');
});

test('implement worker: canonical campaign index shard emits allowed-file product diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/domain-campaigns.mjs',
    'packages/app/routes/campaigns.mjs'
  ], {
    shardId: 'focus.campaign_index',
    issue: { inputs: { focusGroup: 'focus.campaign_index' } },
    shard: {
      id: 'focus.campaign_index',
      allowedFiles: [
        'packages/app/domain-campaigns.mjs',
        'packages/app/routes/campaigns.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.campaign_index', surfaceIds: ['campaign_index'] },
      guardrails: { allowedFiles: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/campaigns.mjs'] }
    }
  });
  const campaignsRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/campaigns.mjs'), 'utf8');
  const campaignsDomain = fs.readFileSync(path.join(workspacePath, 'packages/app/domain-campaigns.mjs'), 'utf8');
  assert.equal(output.surfaceFocusId, 'campaign_index');
  assert.ok(output.modifiedFiles.length >= 1, 'canonical campaign index shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/domain-campaigns.mjs',
    'packages/app/routes/campaigns.mjs'
  ].includes(filePath)), 'canonical campaign index shard should stay within allowed files');
  assert.match(campaignsDomain, /export function campaignIndexSummary/, 'canonical campaign index shard should add an index summary helper');
  assert.match(campaignsRoute, /<h3>Campaign pipeline<\/h3>/, 'canonical campaign index shard should add campaign pipeline cues');
});

test('implement worker: route-only campaign index shard does not introduce a broken domain helper import', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/domain-campaigns.mjs',
    'packages/app/routes/campaigns.mjs'
  ], {
    shardId: 'focus.campaign_index#2',
    issue: { inputs: { focusGroup: 'focus.campaign_index#2' } },
    shard: {
      id: 'focus.campaign_index#2',
      allowedFiles: [
        'packages/app/routes/campaigns.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.campaign_index#2', surfaceIds: ['campaign_index'] },
      guardrails: { allowedFiles: ['packages/app/routes/campaigns.mjs'] }
    }
  });
  const campaignsRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/campaigns.mjs'), 'utf8');
  const campaignsDomain = fs.readFileSync(path.join(workspacePath, 'packages/app/domain-campaigns.mjs'), 'utf8');
  assert.equal(output.surfaceFocusId, 'campaign_index');
  assert.deepEqual(output.modifiedFiles, ['packages/app/routes/campaigns.mjs']);
  assert.doesNotMatch(campaignsRoute, /import \{[^}]*campaignIndexSummary[^}]*\} from '\.\.\/domain-campaigns\.mjs';/, 'route-only campaign index shard should not import a domain helper it cannot patch');
  assert.match(campaignsRoute, /function campaignIndexLocalSummary\(state, workspaceId\)/, 'route-only campaign index shard should use a local summary helper');
  assert.match(campaignsRoute, /const summary = campaignIndexLocalSummary\(state, actor\.workspace\.id\);/, 'route-only campaign index shard should render pipeline cues from the local helper');
  assert.doesNotMatch(campaignsDomain, /export function campaignIndexSummary/, 'route-only campaign index shard should leave the domain file untouched');
});

test('implement worker: canonical reports overview shard emits allowed-file product diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/routes/reports.mjs',
    'packages/app/routes/api-admin.mjs'
  ], {
    shardId: 'focus.reports_overview',
    issue: { inputs: { focusGroup: 'focus.reports_overview' } },
    shard: {
      id: 'focus.reports_overview',
      allowedFiles: [
        'packages/app/routes/reports.mjs',
        'packages/app/routes/api-admin.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.reports_overview', surfaceIds: ['reports_overview'] },
      guardrails: { allowedFiles: ['packages/app/routes/reports.mjs', 'packages/app/routes/api-admin.mjs'] }
    }
  });
  const reportsRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/reports.mjs'), 'utf8');
  const apiAdmin = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/api-admin.mjs'), 'utf8');
  assert.equal(output.surfaceFocusId, 'reports_overview');
  assert.ok(output.modifiedFiles.length >= 1, 'canonical reports overview shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/routes/reports.mjs',
    'packages/app/routes/api-admin.mjs'
  ].includes(filePath)), 'canonical reports overview shard should stay within allowed files');
  assert.match(reportsRoute, /<h3>Report integrity<\/h3>/, 'canonical reports overview shard should add report integrity cues');
  assert.match(apiAdmin, /router\.register\('GET', '\/api\/reports\/summary'/, 'canonical reports overview shard should add an API summary route');
});

test('implement worker: canonical landing pages shard emits allowed-file product diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/routes/website-builder.mjs'
  ], {
    shardId: 'focus.landing_pages',
    issue: { inputs: { focusGroup: 'focus.landing_pages' } },
    shard: {
      id: 'focus.landing_pages',
      allowedFiles: [
        'packages/app/routes/website-builder.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.landing_pages', surfaceIds: ['landing_pages'] },
      guardrails: { allowedFiles: ['packages/app/routes/website-builder.mjs'] }
    }
  });
  const websiteBuilder = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/website-builder.mjs'), 'utf8');
  assert.equal(output.surfaceFocusId, 'landing_pages');
  assert.deepEqual(output.modifiedFiles, ['packages/app/routes/website-builder.mjs']);
  assert.match(websiteBuilder, /<option value="landing">landing<\/option>/, 'canonical landing pages shard should add landing page creation support');
});

test('implement worker: canonical integrations marketplace shard emits allowed-file product diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/domain-integration-marketplace.mjs',
    'packages/app/routes/integrations-marketplace.mjs'
  ], {
    shardId: 'focus.integrations_marketplace',
    issue: { inputs: { focusGroup: 'focus.integrations_marketplace' } },
    shard: {
      id: 'focus.integrations_marketplace',
      allowedFiles: [
        'packages/app/domain-integration-marketplace.mjs',
        'packages/app/routes/integrations-marketplace.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.integrations_marketplace', surfaceIds: ['integrations_marketplace'] },
      guardrails: { allowedFiles: ['packages/app/domain-integration-marketplace.mjs', 'packages/app/routes/integrations-marketplace.mjs'] }
    }
  });
  const domain = fs.readFileSync(path.join(workspacePath, 'packages/app/domain-integration-marketplace.mjs'), 'utf8');
  const integrationsRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/integrations-marketplace.mjs'), 'utf8');
  assert.equal(output.surfaceFocusId, 'integrations_marketplace');
  assert.ok(output.modifiedFiles.length >= 1, 'canonical integrations marketplace shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/domain-integration-marketplace.mjs',
    'packages/app/routes/integrations-marketplace.mjs'
  ].includes(filePath)), 'canonical integrations marketplace shard should stay within allowed files');
  assert.match(domain, /export function integrationMarketplaceSurfaceSummary/, 'canonical integrations marketplace shard should add marketplace summary helpers');
  assert.match(integrationsRoute, /<h3>Connector operations<\/h3>/, 'canonical integrations marketplace shard should add connector operations cues');
});

test('implement worker: canonical signup onboarding shard stays out of forms growth and emits onboarding surfaces', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/index.mjs',
    'packages/app/view.mjs',
    'packages/app/routes/public.mjs',
    'packages/app/routes/platform.mjs'
  ], {
    shardId: 'focus.signup_onboarding',
    issue: { inputs: { focusGroup: 'focus.signup_onboarding' } },
    shard: {
      id: 'focus.signup_onboarding',
      allowedFiles: [
        'packages/app/index.mjs',
        'packages/app/view.mjs',
        'packages/app/routes/public.mjs',
        'packages/app/routes/platform.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.signup_onboarding', surfaceIds: ['signup_onboarding'] },
      guardrails: {
        allowedFiles: [
          'packages/app/index.mjs',
          'packages/app/view.mjs',
          'packages/app/routes/public.mjs',
          'packages/app/routes/platform.mjs'
        ]
      }
    }
  });
  const view = fs.readFileSync(path.join(workspacePath, 'packages/app/view.mjs'), 'utf8');
  const publicRoutes = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/public.mjs'), 'utf8');
  const platformRoutes = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/platform.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'signup_onboarding');
  assert.equal(output.surfaceFocusId, 'signup_onboarding');
  assert.ok(output.modifiedFiles.length >= 1, 'canonical signup onboarding shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/index.mjs',
    'packages/app/view.mjs',
    'packages/app/routes/public.mjs',
    'packages/app/routes/platform.mjs'
  ].includes(filePath)), 'canonical signup onboarding shard should stay within allowed files');
  assert.match(view, /export function signupOnboardingCard/, 'signup onboarding shard should add shared onboarding view helpers');
  assert.match(publicRoutes, /router\.register\('GET', '\/signup\/checklist'/, 'signup onboarding shard should expose checklist public route');
  assert.match(platformRoutes, /router\.register\('GET', '\/onboarding'/, 'signup onboarding shard should add authenticated onboarding route');
});

test('implement worker: canonical settings domains shard emits API and detail surfaces instead of zero-modified no-op', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/routes/api-admin.mjs',
    'packages/app/routes/platform.mjs'
  ], {
    shardId: 'focus.settings_domains',
    issue: { inputs: { focusGroup: 'focus.settings_domains' } },
    shard: {
      id: 'focus.settings_domains',
      allowedFiles: [
        'packages/app/routes/api-admin.mjs',
        'packages/app/routes/platform.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.settings_domains', surfaceIds: ['settings_domains'] },
      guardrails: {
        allowedFiles: [
          'packages/app/routes/api-admin.mjs',
          'packages/app/routes/platform.mjs'
        ]
      }
    }
  });
  const apiAdmin = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/api-admin.mjs'), 'utf8');
  const platformRoutes = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/platform.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'settings_domains');
  assert.equal(output.surfaceFocusId, 'settings_domains');
  assert.ok(output.modifiedFiles.length >= 1, 'canonical settings domains shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/routes/api-admin.mjs',
    'packages/app/routes/platform.mjs'
  ].includes(filePath)), 'canonical settings domains shard should stay within allowed files');
  assert.match(apiAdmin, /router\.register\('GET', '\/api\/settings\/domains'/, 'settings domains shard should expose API domain summary');
  assert.match(platformRoutes, /<h3>Domain readiness<\/h3>/, 'settings domains shard should add settings readiness card');
  assert.match(platformRoutes, /router\.register\('GET', '\/settings\/domains\/:id'/, 'settings domains shard should add domain detail route');
});

test('implement worker: canonical email builder shard still injects its export when automation runtime summary is absent', () => {
  const workspacePath = mkWorkspace([
    'packages/app/domain-campaigns.mjs',
    'packages/app/routes/content-asset-templates.mjs'
  ]);
  const domainPath = path.join(workspacePath, 'packages/app/domain-campaigns.mjs');
  fs.writeFileSync(domainPath, fs.readFileSync(domainPath, 'utf8').replace(/\nexport function campaignAutomationRuntimeSummary\([\s\S]*?\n\}\n\nexport function markCampaignDelivered/, '\nexport function markCampaignDelivered'));
  const assignmentPath = path.join(workspacePath, 'assignment.json');
  fs.writeFileSync(assignmentPath, JSON.stringify({
    targetPath: workspacePath,
    shardId: 'focus.email_builder',
    issue: { inputs: { focusGroup: 'focus.email_builder' } },
    shard: {
      id: 'focus.email_builder',
      allowedFiles: [
        'packages/app/domain-campaigns.mjs',
        'packages/app/routes/content-asset-templates.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.email_builder', surfaceIds: ['email_builder'] },
      guardrails: { allowedFiles: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/content-asset-templates.mjs'] }
    }
  }, null, 2));
  const result = spawnSync(process.execPath, [IMPLEMENT_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40
  });
  assert.equal(result.status, 0, `canonical email builder fallback assignment should succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  const domain = fs.readFileSync(domainPath, 'utf8');
  assert.equal(output.focusGroup, 'email_builder');
  assert.ok(output.modifiedFiles.includes('packages/app/domain-campaigns.mjs'));
  assert.match(domain, /export function emailBuilderParitySummary\(state, workspaceId\)/, 'canonical email builder shard should add the export even when automation runtime summary is absent');
  assert.match(domain, /export function markCampaignDelivered\(state, campaign\)/, 'canonical email builder fallback should preserve the delivery export');
});

test('implement worker: strict automation journey parity shards override stale delivery focus and emit allowed-file diffs', () => {
  const workspacePath = mkWorkspace([
    'packages/app/domain-campaigns.mjs',
    'packages/app/routes/automations.mjs',
    'surface-honesty.json'
  ]);
  const domainPath = path.join(workspacePath, 'packages/app/domain-campaigns.mjs');
  const routesPath = path.join(workspacePath, 'packages/app/routes/automations.mjs');
  fs.writeFileSync(domainPath, fs.readFileSync(domainPath, 'utf8').replace(/\nexport function campaignAutomationRuntimeSummary\([\s\S]*?\n\}\n\nexport function markCampaignDelivered/, '\nexport function markCampaignDelivered'));
  fs.writeFileSync(routesPath, fs.readFileSync(routesPath, 'utf8')
    .replace("import { campaignAutomationRuntimeSummary } from '../domain-campaigns.mjs';\n", '')
    .replace(/\nfunction automationOrchestrationSummary\([\s\S]*?\n\}\n\nexport function registerAutomationRoutes/, '\nexport function registerAutomationRoutes')
    .replace("    const orchestration = automationOrchestrationSummary(state, automation);\n", '')
    .replace(/<div class=\"card\"><h3>Journey orchestration<\/h3>[\s\S]*?<\/div><div class=\"card\"><h3>Enrollment summary<\/h3>/, '<div class="card"><h3>Enrollment summary</h3>')
    .replace('${automation.nodes.map((node, index) => `<tr><td>${index + 1}. ${node.type}</td><td>${node.title}</td><td>${node.delayHours || \'\'} ${node.conditions?.join(\'/\') || \'\'}</td></tr>`).join(\'\')}', '${automation.nodes.map((node) => `<tr><td>${node.type}</td><td>${node.title}</td><td>${node.delayHours || \'\'} ${node.conditions?.join(\'/\') || \'\'}</td></tr>`).join(\'\')}'));
  const assignmentPath = path.join(workspacePath, 'assignment.json');
  fs.writeFileSync(assignmentPath, JSON.stringify({
    targetPath: workspacePath,
    shardId: 'focus.automation_journey_parity',
    issue: { inputs: { focusGroup: 'delivery_jobs' } },
    shard: {
      id: 'focus.automation_journey_parity',
      allowedFiles: [
        'packages/app/domain-campaigns.mjs',
        'packages/app/routes/automations.mjs'
      ]
    }
  }, null, 2));
  const result = spawnSync(process.execPath, [IMPLEMENT_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40
  });
  assert.equal(result.status, 0, `assignment should succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  const automationsRoute = fs.readFileSync(routesPath, 'utf8');
  assert.equal(output.focusGroup, 'automation_journey');
  assert.equal(output.surfaceFocusId, 'automation_journey_parity');
  assert.ok(output.modifiedFiles.length >= 1, 'strict automation journey parity shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/domain-campaigns.mjs',
    'packages/app/routes/automations.mjs'
  ].includes(filePath)), 'strict automation journey parity shard should stay within allowed files');
  assert.match(automationsRoute, /Journey orchestration/, 'strict automation journey parity shard should add orchestration runtime cues to the journey builder');
});

test('implement worker: benchmark automations overview shard stays self-contained when domain-campaigns is not allowed', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/routes/automations.mjs'
  ], {
    shardId: 'focus.automations_overview',
    issue: { inputs: { focusGroup: 'focus.automations_overview' } },
    shard: {
      id: 'focus.automations_overview',
      allowedFiles: [
        'packages/app/routes/automations.mjs',
        'packages/customer-journeys/domain-customer-journeys.mjs',
        'packages/customer-journeys/routes/customer-journeys.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.automations_overview', surfaceIds: ['automations_overview'] },
      guardrails: {
        allowedFiles: [
          'packages/app/routes/automations.mjs',
          'packages/customer-journeys/domain-customer-journeys.mjs',
          'packages/customer-journeys/routes/customer-journeys.mjs'
        ]
      }
    }
  });
  const automationsRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/automations.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'automation_journey');
  assert.equal(output.surfaceFocusId, 'automations_overview');
  assert.deepEqual(output.modifiedFiles, ['packages/app/routes/automations.mjs']);
  assert.doesNotMatch(automationsRoute, /domain-campaigns\.mjs/, 'benchmark automations shard must not import a domain file outside its allowed set');
  assert.match(automationsRoute, /function campaignAutomationRuntimeSummary\(state, campaign\)/, 'benchmark automations shard should carry its runtime summary locally');
  const check = spawnSync(process.execPath, ['--check', path.join(workspacePath, 'packages/app/routes/automations.mjs')], { encoding: 'utf8' });
  assert.equal(check.status, 0, `self-contained automations route should parse\nstdout:\n${check.stdout}\nstderr:\n${check.stderr}`);
});

test('implement worker: strict reporting analytics parity shards override stale delivery focus and emit allowed-file diffs', () => {
  const workspacePath = mkWorkspace([
    'packages/app/domain-commerce-revenue.mjs',
    'surface-honesty.json'
  ]);
  const revenuePath = path.join(workspacePath, 'packages/app/domain-commerce-revenue.mjs');
  fs.writeFileSync(revenuePath, fs.readFileSync(revenuePath, 'utf8')
    .replace(/\nfunction summarizeRevenueSources\([\s\S]*?\n\}\n\nexport function revenueSummary/, '\nexport function revenueSummary')
    .replace(
      "  const topProduct = state.db.commerceProducts.filter((entry) => entry.workspaceId === workspaceId).sort((a, b) => Number(b.price || 0) - Number(a.price || 0))[0] || null;\n  const averageOrderValue = orders.length ? currencyValue(totalRevenue / orders.length) : 0;\n  const sourceBreakdown = summarizeRevenueSources(rows);\n  const topCampaigns = summarizeTopCampaigns(state, rows);\n  const recentActivity = buildRecentRevenueActivity(orders, rows);\n  return {\n    stores: stores.length,\n    products: state.db.commerceProducts.filter((entry) => entry.workspaceId === workspaceId).length,\n    orders: orders.length,\n    totalRevenue,\n    attributedRevenue,\n    unattributedRevenue: currencyValue(totalRevenue - attributedRevenue),\n    attributedShare: totalRevenue > 0 ? Number(((attributedRevenue / totalRevenue) * 100).toFixed(1)) : 0,\n    averageOrderValue,\n    topProduct: topProduct ? { name: topProduct.name, price: topProduct.price } : null,\n    sourceBreakdown,\n    topCampaigns,\n    recentActivity\n  };",
      "  const topProduct = state.db.commerceProducts.filter((entry) => entry.workspaceId === workspaceId).sort((a, b) => Number(b.price || 0) - Number(a.price || 0))[0] || null;\n  return {\n    stores: stores.length,\n    products: state.db.commerceProducts.filter((entry) => entry.workspaceId === workspaceId).length,\n    orders: orders.length,\n    totalRevenue,\n    attributedRevenue,\n    unattributedRevenue: currencyValue(totalRevenue - attributedRevenue),\n    topProduct: topProduct ? { name: topProduct.name, price: topProduct.price } : null\n  };"
    ));
  const assignmentPath = path.join(workspacePath, 'assignment.json');
  fs.writeFileSync(assignmentPath, JSON.stringify({
    targetPath: workspacePath,
    shardId: 'focus.reporting_analytics_parity',
    issue: { inputs: { focusGroup: 'delivery_jobs' } },
    shard: {
      id: 'focus.reporting_analytics_parity',
      allowedFiles: [
        'packages/app/domain-commerce-revenue.mjs'
      ]
    }
  }, null, 2));
  const result = spawnSync(process.execPath, [IMPLEMENT_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40
  });
  assert.equal(result.status, 0, `assignment should succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  const revenueDomain = fs.readFileSync(revenuePath, 'utf8');
  assert.equal(output.focusGroup, 'reporting_analytics');
  assert.equal(output.surfaceFocusId, 'reporting_analytics_parity');
  assert.ok(output.modifiedFiles.length >= 1, 'strict reporting analytics parity shard should produce at least one modified file');
  assert.deepEqual(output.modifiedFiles, ['packages/app/domain-commerce-revenue.mjs']);
  assert.match(revenueDomain, /function summarizeRevenueSources/, 'strict reporting analytics parity shard should add reporting source summaries');
  assert.match(revenueDomain, /averageOrderValue/, 'strict reporting analytics parity shard should enrich the revenue summary payload');
});

test('implement worker: canonical report detail shard emits allowed-file product diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/domain-campaigns.mjs',
    'packages/app/routes/reports.mjs'
  ], {
    shardId: 'focus.report_detail',
    issue: { inputs: { focusGroup: 'focus.report_detail' } },
    shard: {
      id: 'focus.report_detail',
      allowedFiles: [
        'packages/app/domain-campaigns.mjs',
        'packages/app/routes/reports.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.report_detail', surfaceIds: ['report_detail'] },
      guardrails: { allowedFiles: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/reports.mjs'] }
    }
  });
  const reportsRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/reports.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'report_detail');
  assert.equal(output.surfaceFocusId, 'report_detail');
  assert.ok(output.modifiedFiles.length >= 1, 'canonical report detail shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/domain-campaigns.mjs',
    'packages/app/routes/reports.mjs'
  ].includes(filePath)), 'canonical report detail shard should stay within allowed files');
  assert.match(reportsRoute, /<h3>Detail integrity<\/h3>/, 'canonical report detail shard should add detail integrity cues');
});

test('implement worker: canonical send schedule review shard emits allowed-file product diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/domain-campaigns.mjs',
    'packages/app/routes/campaigns.mjs'
  ], {
    shardId: 'focus.send_schedule_review',
    issue: { inputs: { focusGroup: 'focus.send_schedule_review' } },
    shard: {
      id: 'focus.send_schedule_review',
      allowedFiles: [
        'packages/app/domain-campaigns.mjs',
        'packages/app/routes/campaigns.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.send_schedule_review', surfaceIds: ['send_schedule_review'] },
      guardrails: { allowedFiles: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/campaigns.mjs'] }
    }
  });
  const campaignsRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/campaigns.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'send_schedule_review');
  assert.equal(output.surfaceFocusId, 'send_schedule_review');
  assert.ok(output.modifiedFiles.length >= 1, 'canonical send schedule review shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/domain-campaigns.mjs',
    'packages/app/routes/campaigns.mjs'
  ].includes(filePath)), 'canonical send schedule review shard should stay within allowed files');
  assert.match(campaignsRoute, /<h3>Send schedule readiness<\/h3>/, 'canonical send schedule review shard should add schedule readiness cues');
});

test('implement worker: canonical account workspace setup shard emits allowed-file product diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/index.mjs',
    'packages/app/routes/platform.mjs',
    'packages/app/view.mjs'
  ], {
    shardId: 'focus.account_workspace_setup',
    issue: { inputs: { focusGroup: 'focus.account_workspace_setup' } },
    shard: {
      id: 'focus.account_workspace_setup',
      allowedFiles: [
        'packages/app/index.mjs',
        'packages/app/routes/platform.mjs',
        'packages/app/view.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.account_workspace_setup', surfaceIds: ['account_workspace_setup'] },
      guardrails: { allowedFiles: ['packages/app/index.mjs', 'packages/app/routes/platform.mjs', 'packages/app/view.mjs'] }
    }
  });
  const appIndex = fs.readFileSync(path.join(workspacePath, 'packages/app/index.mjs'), 'utf8');
  const platformRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/platform.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'signup_onboarding');
  assert.equal(output.surfaceFocusId, 'account_workspace_setup');
  assert.ok(output.modifiedFiles.length >= 1, 'canonical account workspace setup shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/index.mjs',
    'packages/app/routes/platform.mjs',
    'packages/app/view.mjs'
  ].includes(filePath)), 'canonical account workspace setup shard should stay within allowed files');
  assert.match(appIndex, /signupOnboardingCard/, 'canonical account workspace setup shard should re-export the onboarding card');
  assert.match(platformRoute, /router\.register\('GET', '\/onboarding'/, 'canonical account workspace setup shard should add the onboarding route');
});

test('implement worker: canonical content studio shard emits allowed-file product diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/routes/content-asset-templates.mjs',
    'packages/app/domain-content-ecosystem-depth.mjs'
  ], {
    shardId: 'focus.content_studio',
    issue: { inputs: { focusGroup: 'focus.content_studio' } },
    shard: {
      id: 'focus.content_studio',
      allowedFiles: [
        'packages/app/routes/content-asset-templates.mjs',
        'packages/app/domain-content-ecosystem-depth.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.content_studio', surfaceIds: ['content_studio'] },
      guardrails: { allowedFiles: ['packages/app/routes/content-asset-templates.mjs', 'packages/app/domain-content-ecosystem-depth.mjs'] }
    }
  });
  const contentRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/content-asset-templates.mjs'), 'utf8');
  const contentDomain = fs.readFileSync(path.join(workspacePath, 'packages/app/domain-content-ecosystem-depth.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'content_studio');
  assert.equal(output.surfaceFocusId, 'content_studio');
  assert.ok(output.modifiedFiles.length >= 1, 'canonical content studio shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/routes/content-asset-templates.mjs',
    'packages/app/domain-content-ecosystem-depth.mjs'
  ].includes(filePath)), 'canonical content studio shard should stay within allowed files');
  assert.match(contentDomain, /export function contentDepthSummary\(/, 'canonical content studio shard should add a content depth summary');
  assert.match(contentRoute, /<h3>Content depth<\/h3>/, 'canonical content studio shard should add content depth cues');
});

test('implement worker: canonical api keys and webhooks shard emits allowed-file product diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/routes/api-admin.mjs'
  ], {
    shardId: 'focus.api_keys_webhooks',
    issue: { inputs: { focusGroup: 'focus.api_keys_webhooks' } },
    shard: {
      id: 'focus.api_keys_webhooks',
      allowedFiles: [
        'packages/app/routes/api-admin.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.api_keys_webhooks', surfaceIds: ['api_keys_webhooks'] },
      guardrails: { allowedFiles: ['packages/app/routes/api-admin.mjs'] }
    }
  });
  const apiAdminRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/api-admin.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'api_keys_webhooks');
  assert.equal(output.surfaceFocusId, 'api_keys_webhooks');
  assert.deepEqual(output.modifiedFiles, ['packages/app/routes/api-admin.mjs']);
  assert.match(apiAdminRoute, /router\.register\('GET', '\/api\/developer\/access'/, 'canonical api keys and webhooks shard should add a developer access API surface');
});

test('implement worker: canonical billing plans shard emits allowed-file product diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/routes/api-admin.mjs',
    'packages/app/domain-commerce-revenue.mjs'
  ], {
    shardId: 'focus.billing_plans',
    issue: { inputs: { focusGroup: 'focus.billing_plans' } },
    shard: {
      id: 'focus.billing_plans',
      allowedFiles: [
        'packages/app/routes/api-admin.mjs',
        'packages/app/domain-commerce-revenue.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.billing_plans', surfaceIds: ['billing_plans'] },
      guardrails: { allowedFiles: ['packages/app/routes/api-admin.mjs', 'packages/app/domain-commerce-revenue.mjs'] }
    }
  });
  const apiAdminRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/api-admin.mjs'), 'utf8');
  const revenueDomain = fs.readFileSync(path.join(workspacePath, 'packages/app/domain-commerce-revenue.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'billing_plans');
  assert.equal(output.surfaceFocusId, 'billing_plans');
  assert.ok(output.modifiedFiles.length >= 1, 'canonical billing plans shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/routes/api-admin.mjs',
    'packages/app/domain-commerce-revenue.mjs'
  ].includes(filePath)), 'canonical billing plans shard should stay within allowed files');
  assert.match(revenueDomain, /export function billingPlanSummary\(/, 'canonical billing plans shard should add a billing plan summary');
  assert.match(apiAdminRoute, /router\.register\('GET', '\/api\/billing\/summary'/, 'canonical billing plans shard should add a billing summary API surface');
});

test('implement worker: canonical team roles permissions shard emits allowed-file product diffs', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/routes/api-admin.mjs',
    'packages/app/routes/platform.mjs'
  ], {
    shardId: 'focus.team_roles_permissions',
    issue: { inputs: { focusGroup: 'focus.team_roles_permissions' } },
    shard: {
      id: 'focus.team_roles_permissions',
      allowedFiles: [
        'packages/app/routes/api-admin.mjs',
        'packages/app/routes/platform.mjs'
      ]
    },
    contextPack: {
      shard: { id: 'focus.team_roles_permissions', surfaceIds: ['team_roles_permissions'] },
      guardrails: { allowedFiles: ['packages/app/routes/api-admin.mjs', 'packages/app/routes/platform.mjs'] }
    }
  });
  const apiAdminRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/api-admin.mjs'), 'utf8');
  const platformRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/platform.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'team_roles_permissions');
  assert.equal(output.surfaceFocusId, 'team_roles_permissions');
  assert.ok(output.modifiedFiles.length >= 1, 'canonical team roles permissions shard should produce at least one modified file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/routes/api-admin.mjs',
    'packages/app/routes/platform.mjs'
  ].includes(filePath)), 'canonical team roles permissions shard should stay within allowed files');
  assert.match(apiAdminRoute, /router\.register\('GET', '\/api\/team'/, 'canonical team roles permissions shard should add a team API surface');
  assert.match(platformRoute, /<h3>Role coverage<\/h3>/, 'canonical team roles permissions shard should add role coverage cues');
});

test('implement worker: app facade re-exports persistState for generated package routes', async () => {
  const appFacade = await import(pathToFileURL(path.join(ROOT, 'packages/app/index.mjs')).href);
  assert.equal(typeof appFacade.persistState, 'function');
});

test('implement worker: persistence keeps legacy app.json fallback and adds persistState', () => {
  const { workspacePath } = runFocusGroup(['packages/app/storage.mjs'], 'persistence');
  const storage = fs.readFileSync(path.join(workspacePath, 'packages/app/storage.mjs'), 'utf8');
  assert.match(storage, /app\.json/, 'legacy fallback must remain app.json');
  assert.match(storage, /legacyDbCandidates:\s*Array\.from\(/, 'legacy fallback should enumerate app.json candidates');
  assert.match(storage, /export function persistState\(state\)/, 'persistState should be exported');
});

test('implement worker: strict persistence parity shard stays inside storage scope', () => {
  const { workspacePath, output } = runAssignment([
    'surface-honesty.json',
    'packages/app/storage.mjs'
  ], {
    shardId: 'focus.persistence_jobs_operational_parity',
    issue: { inputs: { focusGroup: 'persistence' } },
    shard: {
      id: 'focus.persistence_jobs_operational_parity',
      allowedFiles: [
        'packages/app/storage.mjs'
      ]
    }
  });
  const storage = fs.readFileSync(path.join(workspacePath, 'packages/app/storage.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'delivery_jobs');
  assert.equal(output.surfaceFocusId, 'persistence_jobs_operational_parity');
  assert.deepEqual(output.modifiedFiles, ['packages/app/storage.mjs']);
  assert.match(storage, /export function storageOperationalSummary\(\)/, 'strict persistence parity should emit an in-scope storage operational summary');
});

test('implement worker: strict ai predictive parity shard emits an admissible ai-provider diff', () => {
  const { workspacePath, output } = runAssignment([
    'surface-honesty.json',
    'packages/app/ai-provider.mjs'
  ], {
    shardId: 'focus.ai_predictive_parity',
    issue: { inputs: { focusGroup: 'ai_predictive' } },
    shard: {
      id: 'focus.ai_predictive_parity',
      allowedFiles: [
        'packages/app/ai-provider.mjs'
      ]
    }
  });
  const provider = fs.readFileSync(path.join(workspacePath, 'packages/app/ai-provider.mjs'), 'utf8');
  const honesty = JSON.parse(fs.readFileSync(path.join(workspacePath, 'surface-honesty.json'), 'utf8'));
  assert.equal(output.focusGroup, 'ai_predictive');
  assert.equal(output.surfaceFocusId, 'ai_predictive_parity');
  assert.deepEqual(output.modifiedFiles, ['packages/app/ai-provider.mjs']);
  assert.match(provider, /mailclone-ai-runtime/, 'ai predictive parity should emit provider metadata into the canonical AI surface');
  assert.match(provider, /proof-led path/, 'ai predictive parity should enrich campaign subject generation');
  assert.equal(honesty.surfaces['packages/app/ai-provider.mjs']?.status, 'real');
  assert.ok(honesty.surfaces['packages/app/ai-provider.mjs']?.evidence?.tests?.includes('tests/current-product-parity.test.mjs'));
});

test('implement worker: integrations parity creates provider bridge and removes fabricated crm sync count', () => {
  const { workspacePath } = runFocusGroup([
    'surface-honesty.json',
    'packages/app/domain-integration-marketplace.mjs',
    'packages/app/routes/api-admin.mjs',
    'packages/app/routes/integrations-marketplace.mjs',
    'packages/app/routes/current-product-ops.mjs'
  ], 'integrations_api_oauth');
  const domain = fs.readFileSync(path.join(workspacePath, 'packages/app/domain-integration-marketplace.mjs'), 'utf8');
  const provider = fs.readFileSync(path.join(workspacePath, 'packages/app/integration-provider.mjs'), 'utf8');
  const apiAdmin = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/api-admin.mjs'), 'utf8');
  const integrationsRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/integrations-marketplace.mjs'), 'utf8');
  const productOpsRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/current-product-ops.mjs'), 'utf8');
  const honesty = JSON.parse(fs.readFileSync(path.join(workspacePath, 'surface-honesty.json'), 'utf8'));
  assert.match(domain, /export async function syncMarketplaceInstallation/, 'integration sync should become async');
  assert.doesNotMatch(domain, /syncedContacts:\s*app\.category === 'crm' \? 12 : 0/, 'fabricated CRM sync counts must be removed');
  assert.equal((domain.match(/installation\.scopes = providerResult\?\.refreshedScopes \|\| installation\.scopes;/g) || []).length, 1, 'integration scope refresh should not duplicate');
  assert.match(provider, /fetch\(/, 'provider bridge should perform a real fetch-based sync call');
  assert.match(apiAdmin, /result: await syncMarketplaceInstallation\(/, 'API admin sync route should await the async integration sync');
  assert.match(integrationsRoute, /if \(installation\) await syncMarketplaceInstallation\(/, 'HTML integrations route should await the async integration sync');
  assert.match(productOpsRoute, /await syncMarketplaceInstallation\(state, actor, installation\)/, 'product ops retry route should await the async integration sync');
  assert.equal(honesty.surfaces['packages/app/domain-integration-marketplace.mjs']?.status, 'real');
  assert.ok(honesty.surfaces['packages/app/integration-provider.mjs']?.evidence?.tests?.includes('tests/integrations-marketplace.test.mjs'));
});

test('implement worker: security ops imports persistState correctly and emits helper modules', () => {
  const { workspacePath } = runFocusGroup(['surface-honesty.json', 'packages/app/security.mjs', 'packages/app/storage.mjs', 'apps/web/server.mjs'], 'security_ops');
  const security = fs.readFileSync(path.join(workspacePath, 'packages/app/security.mjs'), 'utf8');
  const storage = fs.readFileSync(path.join(workspacePath, 'packages/app/storage.mjs'), 'utf8');
  const honesty = JSON.parse(fs.readFileSync(path.join(workspacePath, 'surface-honesty.json'), 'utf8'));
  assert.match(security, /import \{ persistState \} from '\.\/storage\.mjs';/, 'security should import persistState by the correct name');
  assert.doesNotMatch(security, /persistState as saveDb/, 'security should not alias persistState as saveDb');
  assert.match(security, /export function createMfaChallenge/, 'security should expose MFA challenge helper');
  assert.match(security, /export function createSsoSession/, 'security should expose SSO session helper');
  assert.match(security, /persistState\(state\);/, 'security helpers should persist via persistState');
  assert.equal((storage.match(/from '\.\/persistence-io\.mjs';/g) || []).length, 1, 'storage should import persistence IO helpers exactly once');
  assert.ok(fs.existsSync(path.join(workspacePath, 'packages/app/persistence-io.mjs')), 'persistence IO helper should be emitted');
  assert.ok(fs.existsSync(path.join(workspacePath, 'packages/app/http-runtime.mjs')), 'http runtime helper should be emitted');
  assert.equal(honesty.surfaces['packages/app/persistence-io.mjs']?.status, 'real');
  assert.ok(honesty.surfaces['packages/app/http-runtime.mjs']?.evidence?.tests?.includes('tests/security-ops-hardening.test.mjs'));
});

test('implement worker: forms growth patch emits literal form placeholders without crashing the worker script', () => {
  const { workspacePath } = runFocusGroup(['packages/app/routes/forms.mjs', 'packages/app/domain-growth.mjs'], 'forms_growth');
  const formsRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/forms.mjs'), 'utf8');
  assert.match(formsRoute, /\$\{form\.popupMode === 'inline' \? 'selected' : ''\}/, 'forms patch should preserve inline selected placeholder literally');
  assert.match(formsRoute, /\$\{form\.geotarget \|\| ''\}/, 'forms patch should preserve geotarget placeholder literally');
  assert.match(formsRoute, /\$\{form\.triggerRule \|\| 'inline'\}/, 'forms patch should preserve trigger placeholder literally');
});

test('implement worker: landing pages focus is routed separately from website builder ownership', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'orchestrator-real-repo-clean-implement.mjs'), 'utf8');
  assert.match(source, /landing_pages: \['tests\/forms-landing\.test\.mjs'/);
  assert.match(source, /function applyLandingPagesParity\(/);
  assert.match(source, /focus\\\.landing_pages\|landing_pages/);
  assert.match(source, /if \(focusGroup === 'landing_pages'\) applyLandingPagesParity\(workspacePath, modifiedFiles\);/);
});

test('implement worker: surveys-feedback package shards do not get misrouted into forms growth patches', () => {
  const workspacePath = mkWorkspace(['packages/app/routes/forms.mjs', 'packages/app/domain-growth.mjs']);
  const assignmentPath = path.join(workspacePath, 'assignment.json');
  fs.writeFileSync(assignmentPath, JSON.stringify({ targetPath: workspacePath, shardId: 'pkg.surveys-feedback.source' }, null, 2));
  const result = spawnSync(process.execPath, [IMPLEMENT_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40
  });
  assert.equal(result.status, 0, `surveys-feedback shard should not crash\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.focusGroup, 'unknown');
  assert.deepEqual(output.modifiedFiles, [], 'surveys-feedback package shards should remain localized no-ops in the generic bridge');
});

test('implement worker: preference export package shards do not get misrouted into forms growth patches', () => {
  const workspacePath = mkWorkspace(['packages/app/routes/forms.mjs', 'packages/app/domain-growth.mjs']);
  const assignmentPath = path.join(workspacePath, 'assignment.json');
  fs.writeFileSync(assignmentPath, JSON.stringify({ targetPath: workspacePath, shardId: 'pkg.preference-exports.source' }, null, 2));
  const result = spawnSync(process.execPath, [IMPLEMENT_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40
  });
  assert.equal(result.status, 0, `preference-exports shard should not crash\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.focusGroup, 'unknown');
  assert.deepEqual(output.modifiedFiles, [], 'preference export package shards should remain localized no-ops in the generic bridge');
});

test('implement worker: persistence import rewrites also fix package routes that import saveDb via app index exports', () => {
  const { workspacePath } = runFocusGroup([
    'packages/app/storage.mjs',
    'packages/customer-journeys/routes/customer-journeys.mjs',
    'packages/preferences-center/routes/preferences-center.mjs'
  ], 'persistence');
  const journeys = fs.readFileSync(path.join(workspacePath, 'packages/customer-journeys/routes/customer-journeys.mjs'), 'utf8');
  const preferences = fs.readFileSync(path.join(workspacePath, 'packages/preferences-center/routes/preferences-center.mjs'), 'utf8');
  assert.match(journeys, /import \{[^}]*persistState[^}]*\} from '\.\.\/\.\.\/app\/index\.mjs';/, 'customer journeys route should import persistState through app index exports');
  assert.doesNotMatch(journeys, /import \{[^}]*saveDb[^}]*\} from '\.\.\/\.\.\/app\/index\.mjs';/, 'customer journeys route should stop importing saveDb once persistState calls are emitted');
  assert.match(preferences, /import \{[^}]*persistState[^}]*\} from '\.\.\/\.\.\/app\/index\.mjs';/, 'preferences center route should import persistState through app index exports');
  assert.doesNotMatch(preferences, /import \{[^}]*saveDb[^}]*\} from '\.\.\/\.\.\/app\/index\.mjs';/, 'preferences center route should stop importing saveDb once persistState calls are emitted');
});
