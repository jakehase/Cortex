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

function fixtureFileContent(relPath) {
  const fixtureRef = String(process.env.MAILCHIMP_IMPLEMENT_REGRESSION_FIXTURE_REF || 'HEAD').trim() || 'HEAD';
  for (const gitPath of [`mailchimp-clone/${relPath}`, relPath]) {
    const fromRef = spawnSync('git', ['show', `${fixtureRef}:${gitPath}`], {
      cwd: ROOT,
      encoding: 'buffer',
      maxBuffer: 1024 * 1024 * 40
    });
    if (fromRef.status === 0) return fromRef.stdout;
  }
  return fs.readFileSync(path.join(ROOT, relPath));
}

function mkWorkspace(relativeFiles, options = {}) {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-implement-regression-'));
  for (const relPath of relativeFiles) {
    const target = path.join(workspacePath, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const sourceContent = options.source === 'working-tree'
      ? fs.readFileSync(path.join(ROOT, relPath))
      : fixtureFileContent(relPath);
    fs.writeFileSync(target, sourceContent);
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

function runAssignmentInWorkspace(workspacePath, assignment, options = {}) {
  const safeName = String(assignment.shardId || assignment.shard?.id || 'assignment').replace(/[^a-z0-9#._-]+/gi, '_');
  const assignmentPath = path.join(workspacePath, `${safeName}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(assignmentPath, JSON.stringify({ targetPath: workspacePath, ...assignment }, null, 2));
  const result = spawnSync(process.execPath, [IMPLEMENT_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40,
    env: { ...process.env, ...(options.env || {}) }
  });
  assert.equal(result.status, 0, `assignment should succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return { workspacePath, result, output: JSON.parse(result.stdout) };
}

function runAssignment(relativeFiles, assignment, options = {}) {
  const workspacePath = mkWorkspace(relativeFiles, options);
  return runAssignmentInWorkspace(workspacePath, assignment, options);
}

test('implement worker: frontend architecture keeps builder overlay non-interactive', () => {
  const { workspacePath } = runFocusGroup(['packages/app/view.mjs'], 'frontend_architecture');
  const css = fs.readFileSync(path.join(workspacePath, 'apps/web/public/app-shell.css'), 'utf8');
  assert.match(css, /#mailclone-client-shell[\s\S]*pointer-events:\s*none;/, 'client shell chrome should not intercept product workflow clicks');
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

test('implement worker: strict frontend interaction parity does not claim synthetic completion after shell hooks are saturated', () => {
  const workspacePath = mkWorkspace([
    'packages/app/view.mjs',
    'packages/app/routes/public.mjs',
    'apps/web/server.mjs'
  ]);
  const allowedFiles = ['packages/app/view.mjs', 'packages/app/routes/public.mjs', 'apps/web/server.mjs'];

  const outputs = [];
  for (const shardId of ['focus.frontend_interaction_parity#1', 'focus.frontend_interaction_parity#2', 'focus.frontend_interaction_parity#3', 'focus.frontend_interaction_parity#2']) {
    const assignmentPath = path.join(workspacePath, `${shardId.replace(/[^a-z0-9#._-]+/gi, '_')}-${Date.now()}-${Math.random()}.json`);
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
    outputs.push(output);
  }

  assert.ok(outputs.slice(0, 3).every((output) => output.modifiedFiles.length >= 1), 'initial frontend shell slices should emit concrete diffs');
  assert.deepEqual(outputs.at(-1).modifiedFiles, [], 'saturated frontend shell retries should stop instead of appending marker-only followups');
  const concatenated = allowedFiles.map((filePath) => fs.readFileSync(path.join(workspacePath, filePath), 'utf8')).join('\n');
  assert.doesNotMatch(concatenated, /mailchimp_frontend_interaction_followup_v\d+/, 'saturated frontend retries must not add versioned marker-only followups');
});

test('implement worker: benchmark-scoped production surfaces use concrete product handlers instead of zero-file helper no-ops', () => {
  const workspacePath = mkWorkspace([
    'packages/app/view.mjs',
    'packages/app/routes/public.mjs',
    'apps/web/server.mjs'
  ]);
  const assignment = {
    shardId: 'focus.frontend_client_shell_state',
    campaign: { requestedFidelity: 'parity_for_scope' },
    contextPack: { campaign: { requestedFidelity: 'parity_for_scope' } },
    shard: {
      id: 'focus.frontend_client_shell_state',
      surfaceIds: ['frontend_client_shell_state'],
      allowedFiles: ['packages/app/view.mjs', 'packages/app/routes/public.mjs', 'apps/web/server.mjs'],
      metadata: { focusGroup: 'frontend_architecture' }
    }
  };
  const outputs = [
    runAssignmentInWorkspace(workspacePath, assignment).output,
    runAssignmentInWorkspace(workspacePath, assignment).output,
    runAssignmentInWorkspace(workspacePath, assignment).output,
    runAssignmentInWorkspace(workspacePath, assignment).output
  ];
  const concatenated = ['packages/app/view.mjs', 'packages/app/routes/public.mjs', 'apps/web/server.mjs']
    .map((filePath) => fs.readFileSync(path.join(workspacePath, filePath), 'utf8'))
    .join('\n');
  const last = outputs.at(-1);
  assert.ok(outputs.slice(0, 3).every((output) => output.modifiedFiles.length >= 1), 'initial benchmark-scoped passes should make direct product changes');
  assert.ok(last.modifiedFiles.length >= 1, 'idempotent benchmark-scoped pass should still produce a concrete runtime delta instead of a zero-file claim');
  assert.notEqual(last.metadata.claimIntegrityKind, 'zero_modified_files');
  assert.match(concatenated, /buildFrontendClientShellStateRuntimeEvidence/, 'fallback runtime evidence should land in an allowed product file');
  assert.equal(last.metadata.semanticBloatAudit.runtimeIntegrationEvidence.ok, true);
});

test('implement worker: full-clone broad frontend objective is not suppressed by benchmark-scope grounding guard', () => {
  const { output } = runAssignment([
    'packages/app/view.mjs',
    'packages/app/routes/public.mjs',
    'apps/web/server.mjs'
  ], {
    shardId: 'focus.frontend_client_shell_state',
    issue: { inputs: { focusGroup: 'frontend_architecture' } },
    shard: {
      id: 'focus.frontend_client_shell_state',
      title: 'Frontend client shell state, hydration, and browser realism',
      allowedFiles: ['packages/app/view.mjs', 'packages/app/routes/public.mjs', 'apps/web/server.mjs'],
      metadata: { strictGap: true, strictGapDetail: 'Broaden full-clone frontend shell and hydration realism.' }
    },
    contract: { requestedFidelity: 'full_clone' }
  }, { env: { ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone' } });
  assert.equal(output.surfaceFocusId, 'frontend_client_shell_state');
  assert.ok(output.modifiedFiles.length >= 1, 'full-clone broad frontend objective should produce a real product diff');
  assert.equal(output.metadata.claimIntegrityKind, 'substantive_product_delta');
});

test('implement worker: full-clone swarm leaf does not create isolated declarative product modules by default', () => {
  const workspacePath = mkWorkspace([]);
  const leafFile = 'packages/app/full-clone-swarm/signup_onboarding/001-routes-platform.mjs';
  const assignment = {
    targetPath: workspacePath,
    shardId: 'focus.signup_onboarding#1',
    shard: {
      id: 'focus.signup_onboarding#1',
      title: 'Signup and onboarding wizard — routes platform leaf',
      lane: 'signup_onboarding',
      allowedFiles: [leafFile],
      metadata: {
        strictGap: true,
        surfaceFocusId: 'signup_onboarding',
        swarmLeafId: 'focus.signup_onboarding#1',
        sourceProductFile: 'packages/app/routes/platform.mjs',
        strictGapDetail: 'Signup and onboarding needs role-aware workflow states, validation, recovery, and audit handoff.'
      }
    },
    contract: { requestedFidelity: 'full_clone' }
  };
  const assignmentPath = path.join(workspacePath, 'assignment.json');
  fs.writeFileSync(assignmentPath, JSON.stringify(assignment, null, 2));
  const result = spawnSync(process.execPath, [IMPLEMENT_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40,
    env: { ...process.env, ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone' }
  });
  assert.equal(result.status, 0, `swarm leaf assignment should succeed without fabricating product credit\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.modifiedFiles, []);
  assert.equal(output.metadata.swarmLeafId, 'focus.signup_onboarding#1');
  assert.equal(output.metadata.sourceProductFile, 'packages/app/routes/platform.mjs');
  assert.equal(fs.existsSync(path.join(workspacePath, leafFile)), false, 'isolated full-clone swarm modules must not be created for product credit');
});

test('implement worker: structural full-clone leaf does not create isolated declarative product modules by default', () => {
  const workspacePath = mkWorkspace([]);
  const structuralFile = 'packages/app/full-clone-structural/frontend_client_shell_state/001-client_runtime_state.mjs';
  const assignment = {
    targetPath: workspacePath,
    shardId: 'focus.frontend_client_shell_state::structural#1',
    shard: {
      id: 'focus.frontend_client_shell_state::structural#1',
      title: 'Frontend client shell state — client runtime state and browser handoff',
      lane: 'frontend_architecture',
      allowedFiles: [structuralFile],
      metadata: {
        strictGap: true,
        structuralFullClone: true,
        surfaceFocusId: 'frontend_client_shell_state',
        structuralLeafId: 'focus.frontend_client_shell_state::structural#1',
        structuralPhaseId: 'client_runtime_state',
        structuralPhaseTitle: 'client runtime state and browser handoff',
        sourceProductFile: 'apps/web/public/app-shell.jsx',
        strictGapDetail: 'Build a real browser-side app shell with state handoff, asset serving, and interaction hooks.'
      }
    },
    contract: { requestedFidelity: 'full_clone' }
  };
  const assignmentPath = path.join(workspacePath, 'assignment.json');
  fs.writeFileSync(assignmentPath, JSON.stringify(assignment, null, 2));
  const result = spawnSync(process.execPath, [IMPLEMENT_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40,
    env: { ...process.env, ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone' }
  });
  assert.equal(result.status, 0, `structural leaf assignment should succeed without fabricating product credit\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.modifiedFiles, []);
  assert.equal(output.metadata.structuralLeafId, 'focus.frontend_client_shell_state::structural#1');
  assert.equal(output.metadata.structuralPhaseId, 'client_runtime_state');
  assert.equal(fs.existsSync(path.join(workspacePath, structuralFile)), false, 'isolated full-clone structural modules must not be created for product credit');
});

test('implement worker: frontier full-clone leaf does not create isolated declarative product modules by default', () => {
  const workspacePath = mkWorkspace([]);
  const frontierFile = 'packages/app/full-clone-frontier/frontend_client_shell_state/001-rich_client_application_spine.mjs';
  const assignment = {
    targetPath: workspacePath,
    shardId: 'focus.frontend_client_shell_state::frontier#1',
    shard: {
      id: 'focus.frontend_client_shell_state::frontier#1',
      title: 'Frontend client shell state — rich client application spine and editor host',
      lane: 'frontend_architecture',
      allowedFiles: [frontierFile],
      metadata: {
        strictGap: true,
        structuralFullClone: true,
        frontierFullClone: true,
        surfaceFocusId: 'frontend_client_shell_state',
        structuralLeafId: 'focus.frontend_client_shell_state::frontier#1',
        frontierLeafId: 'focus.frontend_client_shell_state::frontier#1',
        structuralPhaseId: 'rich_client_application_spine',
        structuralPhaseTitle: 'rich client application spine and editor host',
        sourceProductFile: 'apps/web/public/app-shell.jsx',
        strictGapDetail: 'Build a real browser-side app shell with state handoff, asset serving, editor interaction hooks, persistence, provider runtime boundaries, and browser-backed evidence.'
      }
    },
    contract: { requestedFidelity: 'full_clone' }
  };
  const assignmentPath = path.join(workspacePath, 'assignment.json');
  fs.writeFileSync(assignmentPath, JSON.stringify(assignment, null, 2));
  const result = spawnSync(process.execPath, [IMPLEMENT_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40,
    env: { ...process.env, ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone' }
  });
  assert.equal(result.status, 0, `frontier leaf assignment should succeed without fabricating product credit\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.modifiedFiles, []);
  assert.equal(output.metadata.frontierLeafId, 'focus.frontend_client_shell_state::frontier#1');
  assert.equal(output.metadata.structuralPhaseId, 'rich_client_application_spine');
  assert.equal(fs.existsSync(path.join(workspacePath, frontierFile)), false, 'isolated full-clone frontier modules must not be created for product credit');
});

test('implement worker: remediation full-clone leaf refuses isolated remaining-work modules without primary adoption targets', async () => {
  const workspacePath = mkWorkspace([]);
  const remediationFile = 'packages/app/full-clone-remediation/frontend_client_shell_state/001-client_app_runtime_adoption.mjs';
  const assignment = {
    targetPath: workspacePath,
    shardId: 'focus.frontend_client_shell_state::remediation#1',
    shard: {
      id: 'focus.frontend_client_shell_state::remediation#1',
      title: 'Frontend client shell state — client application runtime adoption slice',
      lane: 'frontend_architecture',
      allowedFiles: [remediationFile],
      metadata: {
        strictGap: true,
        structuralFullClone: true,
        frontierFullClone: true,
        remediationFullClone: true,
        surfaceFocusId: 'frontend_client_shell_state',
        structuralLeafId: 'focus.frontend_client_shell_state::remediation#1',
        frontierLeafId: 'focus.frontend_client_shell_state::remediation#1',
        remediationLeafId: 'focus.frontend_client_shell_state::remediation#1',
        structuralPhaseId: 'client_app_runtime_adoption',
        structuralPhaseTitle: 'client application runtime adoption slice',
        sourceProductFile: 'apps/web/public/app-shell.jsx',
        strictGapDetail: 'Build or adopt a real client application layer for editor-heavy surfaces and prevent scoped-green/no-throughput saturation.'
      }
    },
    contract: { requestedFidelity: 'full_clone' }
  };
  const assignmentPath = path.join(workspacePath, 'assignment.json');
  fs.writeFileSync(assignmentPath, JSON.stringify(assignment, null, 2));
  const result = spawnSync(process.execPath, [IMPLEMENT_SCRIPT, '--assignment', assignmentPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40,
    env: { ...process.env, ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone' }
  });
  assert.equal(result.status, 0, `remediation leaf assignment should succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.modifiedFiles, [], 'isolated remediation modules should not count as runnable adoption work');
  assert.equal(output.metadata.remediationLeafId, 'focus.frontend_client_shell_state::remediation#1');
  assert.equal(output.metadata.structuralPhaseId, 'client_app_runtime_adoption');
  assert.equal(fs.existsSync(path.join(workspacePath, remediationFile)), false, 'worker should not create a standalone full-clone-remediation file');
});

test('implement worker: continuation full-clone leaf emits primary-runtime adoption after canonical audience handler is saturated', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/domain-audience.mjs',
    'packages/app/routes/audience.mjs',
    'packages/app/security.mjs',
    'packages/app/storage.mjs'
  ], {
    shard: {
      id: 'focus.audience_overview::continuation-001#15',
      title: 'Audience overview — continuation wave 001 — data privacy and compliance runtime slice',
      lane: 'frontend_architecture',
      allowedFiles: [
        'packages/app/domain-audience.mjs',
        'packages/app/routes/audience.mjs',
        'packages/app/security.mjs',
        'packages/app/storage.mjs'
      ],
      metadata: {
        strictGap: true,
        structuralFullClone: true,
        frontierFullClone: true,
        remediationFullClone: true,
        continuationFullClone: true,
        primaryProductAdoptionRequired: true,
        surfaceFocusId: 'audience_overview',
        structuralLeafId: 'focus.audience_overview::continuation-001#15',
        frontierLeafId: 'focus.audience_overview::continuation-001#15',
        remediationLeafId: 'focus.audience_overview::continuation-001#15',
        structuralPhaseId: 'continuation_wave_001_data_privacy_compliance_runtime',
        structuralPhaseTitle: 'continuation wave 001 — data privacy and compliance runtime slice',
        primaryAdoptionFile: 'packages/app/domain-audience.mjs',
        primaryAdoptionFiles: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs', 'packages/app/security.mjs', 'packages/app/storage.mjs'],
        sourceProductFile: 'packages/app/domain-audience.mjs',
        strictGapDetail: 'Capture deletion, consent provenance, suppression boundaries, retention windows, exportability, legal hold, and compliance audit metadata.'
      }
    },
    contract: { requestedFidelity: 'full_clone' }
  }, { env: { ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone', MAILCHIMP_REQUIRE_DEEP_ARCHITECTURE_CREDIT: '1' } });

  assert.ok(output.modifiedFiles.length >= 2, 'deep-credit continuation audience adoption should modify at least two primary runtime files');
  assert.equal(output.metadata.architectureEvidence?.ok, true, 'deep-credit continuation adoption should emit passing architecture evidence');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/domain-audience.mjs',
    'packages/app/routes/audience.mjs',
    'packages/app/security.mjs',
    'packages/app/storage.mjs'
  ].includes(filePath)), 'continuation audience adoption should stay within primary adoption files');
  assert.equal(output.metadata.claimIntegrityKind, 'substantive_product_delta');
  const audienceRuntime = [
    'packages/app/domain-audience.mjs',
    'packages/app/routes/audience.mjs',
    'packages/app/security.mjs',
    'packages/app/storage.mjs'
  ].map((filePath) => fs.readFileSync(path.join(workspacePath, filePath), 'utf8')).join('\n');
  assert.equal(output.metadata.structuralPhaseId, 'continuation_wave_001_data_privacy_compliance_runtime');
  assert.doesNotMatch(audienceRuntime, /full_clone_remediation_leaf_evaluated/);
});

test('implement worker: continuation full-clone leaf emits primary-runtime adoption after canonical automation handler is saturated', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/domain-campaigns.mjs',
    'packages/app/domain-growth.mjs',
    'packages/app/job-runtime.mjs',
    'packages/app/routes/automations.mjs'
  ], {
    shard: {
      id: 'focus.automation_journey_execution::continuation-001#13#1',
      title: 'Automation journey execution runtime — continuation wave 001 — asset rendering and delivery pipeline slice',
      lane: 'automation_journey',
      allowedFiles: [
        'packages/app/domain-campaigns.mjs',
        'packages/app/domain-growth.mjs',
        'packages/app/job-runtime.mjs',
        'packages/app/routes/automations.mjs'
      ],
      metadata: {
        strictGap: true,
        structuralFullClone: true,
        frontierFullClone: true,
        remediationFullClone: true,
        continuationFullClone: true,
        primaryProductAdoptionRequired: true,
        surfaceFocusId: 'automation_journey_execution',
        structuralLeafId: 'focus.automation_journey_execution::continuation-001#13',
        frontierLeafId: 'focus.automation_journey_execution::continuation-001#13',
        remediationLeafId: 'focus.automation_journey_execution::continuation-001#13',
        structuralPhaseId: 'continuation_wave_001_asset_rendering_pipeline_runtime',
        structuralPhaseTitle: 'continuation wave 001 — asset rendering and delivery pipeline slice',
        primaryAdoptionFile: 'packages/app/domain-campaigns.mjs',
        primaryAdoptionFiles: ['packages/app/domain-campaigns.mjs', 'packages/app/domain-growth.mjs', 'packages/app/job-runtime.mjs', 'packages/app/routes/automations.mjs'],
        sourceProductFile: 'packages/app/domain-campaigns.mjs',
        strictGapDetail: 'Add image/file asset normalization, template rendering, CDN/cache metadata, preview fidelity, and recoverable publish/delivery handoff.'
      }
    },
    contract: { requestedFidelity: 'full_clone' }
  }, { env: { ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone' } });

  assert.ok(output.modifiedFiles.length >= 1, 'continuation automation adoption should modify at least one primary runtime file');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/domain-campaigns.mjs',
    'packages/app/domain-growth.mjs',
    'packages/app/job-runtime.mjs',
    'packages/app/routes/automations.mjs'
  ].includes(filePath)), 'continuation automation adoption should stay within primary adoption files');
  assert.equal(output.metadata.claimIntegrityKind, 'substantive_product_delta');
  const automationRuntime = [
    'packages/app/domain-campaigns.mjs',
    'packages/app/domain-growth.mjs',
    'packages/app/job-runtime.mjs',
    'packages/app/routes/automations.mjs'
  ].map((filePath) => fs.readFileSync(path.join(workspacePath, filePath), 'utf8')).join('\n');
  assert.equal(output.metadata.structuralPhaseId, 'continuation_wave_001_asset_rendering_pipeline_runtime');
  assert.doesNotMatch(automationRuntime, /full_clone_remediation_leaf_evaluated/);
});

test('implement worker: continuation primary-runtime adoption reuses compact runtime helper instead of duplicating boilerplate per shard', () => {
  const workspacePath = mkWorkspace([
    'packages/app/domain-audience.mjs',
    'packages/app/routes/audience.mjs',
    'packages/app/security.mjs',
    'packages/app/storage.mjs'
  ]);
  const allowedFiles = [
    'packages/app/domain-audience.mjs',
    'packages/app/routes/audience.mjs',
    'packages/app/security.mjs',
    'packages/app/storage.mjs'
  ];

  for (const [index, phaseId] of ['continuation_wave_001_data_privacy_compliance_runtime', 'continuation_wave_002_approval_lifecycle_runtime', 'continuation_wave_003_browser_runtime'].entries()) {
    const { output } = runAssignmentInWorkspace(workspacePath, {
      shard: {
        id: `focus.audience_identity_lifecycle::continuation-00${index + 1}#1`,
        title: `Audience identity lifecycle — ${phaseId}`,
        lane: 'audience_identity',
        allowedFiles,
        metadata: {
          strictGap: true,
          structuralFullClone: true,
          frontierFullClone: true,
          remediationFullClone: true,
          continuationFullClone: true,
          primaryProductAdoptionRequired: true,
          surfaceFocusId: 'audience_identity_lifecycle',
          structuralLeafId: `focus.audience_identity_lifecycle::continuation-00${index + 1}#1`,
          frontierLeafId: `focus.audience_identity_lifecycle::continuation-00${index + 1}#1`,
          remediationLeafId: `focus.audience_identity_lifecycle::continuation-00${index + 1}#1`,
          structuralPhaseId: phaseId,
          structuralPhaseTitle: phaseId.replace(/_/g, ' '),
          primaryAdoptionFile: 'packages/app/domain-audience.mjs',
          primaryAdoptionFiles: allowedFiles,
          sourceProductFile: 'packages/app/domain-audience.mjs',
          sourceProductFiles: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'],
          strictGapDetail: 'Capture lifecycle state, role-aware workflow transitions, audit handoff, and recovery behavior.'
        }
      },
      contract: { requestedFidelity: 'full_clone' }
    }, { env: { ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone', MAILCHIMP_REQUIRE_DEEP_ARCHITECTURE_CREDIT: '1' } });
    assert.ok(output.modifiedFiles.length >= 1, `${phaseId} should emit compact primary runtime work`);
    assert.equal(output.metadata.claimIntegrityKind, 'substantive_product_delta');
  }

  const runtime = allowedFiles.map((filePath) => fs.readFileSync(path.join(workspacePath, filePath), 'utf8')).join('\n');
  const helperCopies = runtime.match(/function evaluatePrimaryRuntimeAdoption\(config/g) || [];
  const repeatedWorkspaceLines = runtime.match(/const workspaceId = input\.workspaceId/g) || [];
  assert.ok(helperCopies.length <= 2, `shared helper should be emitted once per touched runtime layer, got ${helperCopies.length}`);
  assert.ok(repeatedWorkspaceLines.length <= 2, `primary adoption boilerplate should not repeat per continuation shard, got ${repeatedWorkspaceLines.length}`);
  assert.doesNotMatch(runtime, /full_clone_remediation_leaf_evaluated|"requirements": \[/, 'continuation adoption must not fall back to remediation blueprint bulk');
});

test('implement worker: strict frontend interaction parity without allowed files does not fabricate fallback completion', () => {
  const workspacePath = mkWorkspace([
    'packages/app/view.mjs',
    'packages/app/routes/public.mjs',
    'apps/web/server.mjs'
  ]);
  const seeded = [
    { shardId: 'focus.frontend_interaction_parity#1', shard: { id: 'focus.frontend_interaction_parity#1', allowedFiles: ['packages/app/view.mjs', 'packages/app/routes/public.mjs', 'apps/web/server.mjs'] } },
    { shardId: 'focus.frontend_interaction_parity#2', shard: { id: 'focus.frontend_interaction_parity#2', allowedFiles: ['packages/app/view.mjs', 'packages/app/routes/public.mjs', 'apps/web/server.mjs'] } },
    { shardId: 'focus.frontend_interaction_parity#3', shard: { id: 'focus.frontend_interaction_parity#3', allowedFiles: ['packages/app/view.mjs', 'packages/app/routes/public.mjs', 'apps/web/server.mjs'] } },
    { shardId: 'focus.frontend_interaction_parity#2', shard: { id: 'focus.frontend_interaction_parity#2' } }
  ];
  const outputs = [];
  for (const assignment of seeded) {
    const assignmentPath = path.join(workspacePath, `${assignment.shardId.replace(/[^a-z0-9#._-]+/gi, '_')}-${Date.now()}-${Math.random()}.json`);
    fs.writeFileSync(assignmentPath, JSON.stringify({
      targetPath: workspacePath,
      issue: { inputs: { focusGroup: 'frontend_architecture' } },
      ...assignment
    }, null, 2));
    const result = spawnSync(process.execPath, [IMPLEMENT_SCRIPT, '--assignment', assignmentPath], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 40
    });
    assert.equal(result.status, 0, `${assignment.shardId} should succeed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const output = JSON.parse(result.stdout);
    outputs.push(output);
  }
  assert.ok(outputs.slice(0, 3).every((output) => output.modifiedFiles.length >= 1), 'allowed frontend shell slices should emit concrete diffs');
  assert.deepEqual(outputs.at(-1).modifiedFiles, [], 'missing allowed files after saturation should be a no-op, not fabricated completion');
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

test('implement worker: canonical contacts table shard emits operational product depth after CRM bridge saturation', () => {
  const allowedFiles = [
    'packages/app/domain-audience.mjs',
    'packages/app/routes/audience.mjs'
  ];
  const { workspacePath, output } = runAssignment(allowedFiles, {
    shardId: 'focus.contacts_table',
    issue: { inputs: { focusGroup: 'focus.contacts_table' } },
    shard: {
      id: 'focus.contacts_table',
      allowedFiles,
      metadata: { strictGap: true, strictGapDetail: 'Deepen contacts-table sorting, saved columns, suppression, pagination, and merge/dedup flows.' }
    },
    contract: { requestedFidelity: 'full_clone' },
    contextPack: {
      shard: { id: 'focus.contacts_table', surfaceIds: ['contacts_table'] },
      guardrails: { allowedFiles },
      assignmentContract: { targetFiles: allowedFiles }
    }
  }, { source: 'working-tree', env: { ORCHESTRATOR_REQUESTED_FIDELITY: 'full_clone' } });
  const audienceDomain = fs.readFileSync(path.join(workspacePath, 'packages/app/domain-audience.mjs'), 'utf8');
  const audienceRoute = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/audience.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'audience_crm');
  assert.equal(output.surfaceFocusId, 'contacts_table');
  assert.ok(output.modifiedFiles.length >= 1, 'contacts-table shard should produce a real allowed-file product diff');
  assert.ok(output.modifiedFiles.every((filePath) => allowedFiles.includes(filePath)), 'contacts-table shard should stay within allowed files');
  assert.match(audienceDomain, /buildContactsTableViewModel/, 'contacts-table shard should add a real table view-model, not a marker-only followup');
  assert.match(audienceRoute, /Table operations/, 'contacts-table route should expose operational table controls and evidence');
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

test('implement worker: saturated canonical signup onboarding shard escalates to recovery/resume product depth instead of no-op', () => {
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
  const index = fs.readFileSync(path.join(workspacePath, 'packages/app/index.mjs'), 'utf8');
  assert.equal(output.focusGroup, 'signup_onboarding');
  assert.equal(output.surfaceFocusId, 'signup_onboarding');
  assert.ok(output.modifiedFiles.length >= 1, 'saturated signup onboarding shard should produce a real recovery/resume product diff');
  assert.ok(output.modifiedFiles.every((filePath) => [
    'packages/app/index.mjs',
    'packages/app/view.mjs',
    'packages/app/routes/public.mjs',
    'packages/app/routes/platform.mjs'
  ].includes(filePath)), 'saturated signup onboarding shard should stay within allowed files');
  assert.match(index, /signupOnboardingRecoveryPanel/, 'saturated signup shard should export recovery helpers');
  assert.match(view, /signupOnboardingJourneyReadiness/, 'saturated signup shard should add readiness state');
  assert.match(view, /signupOnboardingRecoveryPanel/, 'saturated signup shard should add recovery UI');
  assert.match(publicRoutes, /router\.register\('GET', '\/signup\/resume'/, 'saturated signup shard should expose public resume route');
  assert.match(platformRoutes, /router\.register\('GET', '\/onboarding\/recovery'/, 'saturated signup shard should expose authenticated recovery route');
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

test('implement worker: saturated strict parity shards stop instead of emitting marker-only followup deltas', () => {
  const cases = [
    {
      shardId: 'focus.automation_journey_parity',
      surfaceFocusId: 'automation_journey_parity',
      allowedFiles: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/automations.mjs'],
      marker: /mailchimp_automation_journey_parity_followup_v\d+/
    },
    {
      shardId: 'focus.campaign_editor_parity#1',
      surfaceFocusId: 'campaign_editor_parity',
      allowedFiles: [
        'packages/template-variants/domain-template-variants.mjs',
        'packages/template-approvals/domain-template-approvals.mjs',
        'packages/template-variants/index.mjs',
        'packages/template-approvals/index.mjs'
      ],
      marker: /mailchimp_campaign_editor_parity_followup_v\d+/
    },
    {
      shardId: 'focus.audience_crm_parity',
      surfaceFocusId: 'audience_crm_parity',
      allowedFiles: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs', 'packages/app/storage.mjs'],
      marker: /mailchimp_audience_crm_parity_followup_v\d+/
    },
    {
      shardId: 'focus.reporting_analytics_parity',
      surfaceFocusId: 'reporting_analytics_parity',
      allowedFiles: ['packages/app/domain-commerce-revenue.mjs'],
      marker: /mailchimp_reporting_analytics_parity_followup_v\d+/
    }
  ];

  for (const entry of cases) {
    const assignment = {
      shardId: entry.shardId,
      issue: { inputs: { focusGroup: 'delivery_jobs' } },
      shard: { id: entry.shardId, allowedFiles: entry.allowedFiles },
      contextPack: {
        shard: { id: entry.shardId, surfaceIds: [entry.surfaceFocusId] },
        guardrails: { allowedFiles: entry.allowedFiles },
        assignmentContract: { targetFiles: entry.allowedFiles }
      }
    };
    const workspacePath = mkWorkspace(entry.allowedFiles);
    for (let seed = 0; seed < 6; seed += 1) {
      const seeded = runAssignmentInWorkspace(workspacePath, assignment);
      if (seeded.output.modifiedFiles.length === 0) break;
    }
    const { output } = runAssignmentInWorkspace(workspacePath, assignment);
    assert.equal(output.surfaceFocusId, entry.surfaceFocusId);
    assert.deepEqual(output.modifiedFiles, [], `${entry.shardId} should not emit marker-only followup diffs when saturated`);
    const allowedText = entry.allowedFiles.map((filePath) => fs.readFileSync(path.join(workspacePath, filePath), 'utf8')).join('\n');
    assert.doesNotMatch(allowedText, entry.marker, `${entry.shardId} must not append a versioned strict parity followup marker`);
  }
});


test('implement worker: saturated benchmark-scope parity lanes do not emit benchmark-only density helpers', () => {
  const allowedFiles = ['packages/app/domain-campaigns.mjs', 'packages/app/routes/automations.mjs'];
  const { workspacePath, output } = runAssignment(allowedFiles, {
    shardId: 'focus.automation_journey_parity',
    shard: {
      id: 'focus.automation_journey_parity',
      title: 'automation_journey_parity parity',
      domain: 'mailchimp_benchmark_surface',
      allowedFiles,
      surfaceIds: ['automation_journey_parity']
    },
    contextPack: {
      shard: {
        id: 'focus.automation_journey_parity',
        title: 'automation_journey_parity parity',
        domain: 'mailchimp_benchmark_surface',
        surfaceIds: ['automation_journey_parity']
      },
      guardrails: { allowedFiles },
      assignmentContract: { targetFiles: allowedFiles },
      inputs: { implementationPolicy: 'Make real product-surface changes for the benchmark-scoped Mailchimp production-creation surfaces.' }
    }
  }, { source: 'working-tree' });
  assert.equal(output.surfaceFocusId, 'automation_journey_parity');
  assert.ok(output.modifiedFiles.every((filePath) => allowedFiles.includes(filePath)), 'benchmark-scoped work must stay within allowed files');
  const changedText = output.modifiedFiles.map((filePath) => fs.readFileSync(path.join(workspacePath, filePath), 'utf8')).join('\n');
  assert.doesNotMatch(changedText, /mailchimp_product_density_|ProductDensity|mailchimp_surface_grounding_|SurfaceGrounding/);
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

test('implement worker: saturated account workspace setup shard stops instead of marker-only followup delta', () => {
  const allowedFiles = [
    'packages/app/index.mjs',
    'packages/app/routes/platform.mjs',
    'packages/app/view.mjs'
  ];
  const assignment = {
    shardId: 'focus.account_workspace_setup',
    issue: { inputs: { focusGroup: 'focus.account_workspace_setup' } },
    shard: {
      id: 'focus.account_workspace_setup',
      allowedFiles
    },
    contextPack: {
      shard: { id: 'focus.account_workspace_setup', surfaceIds: ['account_workspace_setup'] },
      guardrails: { allowedFiles },
      assignmentContract: { targetFiles: allowedFiles }
    }
  };
  const workspacePath = mkWorkspace(allowedFiles);
  runAssignmentInWorkspace(workspacePath, assignment, { env: { ORCHESTRATOR_REQUESTED_FIDELITY: '' } });
  const { output } = runAssignmentInWorkspace(workspacePath, assignment, { env: { ORCHESTRATOR_REQUESTED_FIDELITY: '' } });
  assert.equal(output.surfaceFocusId, 'account_workspace_setup');
  assert.deepEqual(output.modifiedFiles, [], 'saturated account workspace setup shard should not fabricate a followup product diff outside full-clone strict-gap mode');
  const allowedText = allowedFiles
    .map((filePath) => fs.readFileSync(path.join(workspacePath, filePath), 'utf8'))
    .join('\n');
  assert.doesNotMatch(allowedText, /mailchimp_account_workspace_setup_followup_v\d+/, 'saturated account setup must not append a versioned followup marker');
});

test('implement worker: context-pack full-clone strict gaps emit product depth even when shard metadata is not packed', () => {
  const previousFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  try {
    const { workspacePath, output } = runAssignment([
      'packages/app/routes/api-admin.mjs'
    ], {
      shardId: 'focus.api_keys_webhooks',
      issue: { inputs: { focusGroup: 'integrations_api_oauth' }, title: 'API keys and webhooks' },
      shard: {
        id: 'focus.api_keys_webhooks',
        title: 'API keys and webhooks',
        lane: 'integrations_api_oauth',
        allowedFiles: ['packages/app/routes/api-admin.mjs']
      },
      contextPack: {
        campaign: { requestedFidelity: 'full_clone' },
        shard: { id: 'focus.api_keys_webhooks', surfaceIds: ['api_keys_webhooks'] },
        guardrails: { allowedFiles: ['packages/app/routes/api-admin.mjs'] },
        assignmentContract: { targetFiles: ['packages/app/routes/api-admin.mjs'] }
      }
    });
    assert.equal(output.surfaceFocusId, 'api_keys_webhooks');
    assert.ok(output.modifiedFiles.length >= 1, 'context-pack full_clone fidelity should still trigger canonical product work instead of zero-modified output');
    const productText = output.modifiedFiles.map((filePath) => fs.readFileSync(path.join(workspacePath, filePath), 'utf8')).join('\n');
    assert.match(productText, /router\.register\('GET', '\/api\/developer\/access'/, 'full-clone context should produce real developer API runtime changes');
    assert.doesNotMatch(productText, /FullCloneDepthBlueprint|full_clone_depth_evaluated|\"requirements\": \[|\"fidelity\": \"full_clone\"/, 'full-clone context must not append declarative blueprint bulk to product files');
  } finally {
    if (previousFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
    else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = previousFidelity;
  }
});

test('implement worker: full-clone strict gaps emit substantive product depth diffs instead of zero-modified output', () => {
  const previousFidelity = process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
  process.env.ORCHESTRATOR_REQUESTED_FIDELITY = 'full_clone';
  try {
    const { workspacePath, output } = runAssignment([
      'packages/app/routes/api-admin.mjs',
      'packages/app/domain-commerce-revenue.mjs'
    ], {
      shardId: 'focus.billing_plans',
      issue: { inputs: { focusGroup: 'commerce_revenue' }, title: 'Billing plans' },
      shard: {
        id: 'focus.billing_plans',
        title: 'Billing plans',
        lane: 'commerce_revenue',
        allowedFiles: ['packages/app/routes/api-admin.mjs', 'packages/app/domain-commerce-revenue.mjs'],
        metadata: {
          strictGap: true,
          strictGapDetail: 'Implement plan entitlement checks, billing summaries, limits, invoices, and plan-change decision support.'
        }
      },
      contextPack: {
        assignmentContract: { targetFiles: ['packages/app/routes/api-admin.mjs', 'packages/app/domain-commerce-revenue.mjs'] }
      }
    });
    assert.equal(output.surfaceFocusId, 'billing_plans');
    assert.ok(output.modifiedFiles.length >= 1, 'full-clone strict gap should produce a product file modification');
    assert.ok(output.modifiedFiles.every((filePath) => ['packages/app/routes/api-admin.mjs', 'packages/app/domain-commerce-revenue.mjs'].includes(filePath)));
    const productText = output.modifiedFiles.map((filePath) => fs.readFileSync(path.join(workspacePath, filePath), 'utf8')).join('\n');
    assert.match(productText, /billingPlanSummary|router\.register\('GET', '\/api\/billing\/summary'/, 'strict gap should use canonical product runtime changes');
    assert.doesNotMatch(productText, /FullCloneDepthBlueprint|full_clone_depth_evaluated|roleCoverage|\"requirements\": \[|\"fidelity\": \"full_clone\"/);
    assert.doesNotMatch(productText, /ProductDensityV1|mailchimp_product_density_|mailchimp_surface_grounding_|strictParityFollowup/);
  } finally {
    if (previousFidelity === undefined) delete process.env.ORCHESTRATOR_REQUESTED_FIDELITY;
    else process.env.ORCHESTRATOR_REQUESTED_FIDELITY = previousFidelity;
  }
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
  assert.ok(
    output.modifiedFiles.length === 0 || output.modifiedFiles.every((filePath) => filePath === 'packages/app/storage.mjs'),
    'strict persistence parity should either add storage evidence or recognize an already-saturated storage surface without touching unrelated files'
  );
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

test('implement worker: remediation leaves adopt primary runtime files instead of isolated full-clone modules', () => {
  const fullCloneLeafPath = 'packages/app/full-clone-remediation/campaign_editor/001-client_app_runtime_adoption.mjs';
  const { workspacePath, output } = runAssignment([
    'packages/app/domain-campaigns.mjs'
  ], {
    shardId: 'focus.campaign_editor::remediation#1',
    campaign: { requestedFidelity: 'full_clone' },
    issue: { inputs: { focusGroup: 'campaign_editor' } },
    shard: {
      id: 'focus.campaign_editor::remediation#1',
      surfaceIds: ['campaign_editor'],
      allowedFiles: ['packages/app/domain-campaigns.mjs', fullCloneLeafPath],
      metadata: {
        remediationLeafId: 'focus.campaign_editor::remediation#1',
        strictGap: true,
        remediationFullClone: true,
        structuralPhaseId: 'client_app_runtime_adoption',
        structuralPhaseTitle: 'client application runtime adoption slice',
        sourceProductFile: 'packages/app/domain-campaigns.mjs',
        primaryProductAdoptionRequired: true,
        primaryAdoptionFiles: ['packages/app/domain-campaigns.mjs']
      }
    }
  });
  assert.deepEqual(output.modifiedFiles, [], 'marker-only remediation leaves must stop instead of fabricating product credit');
  assert.equal(output.metadata.claimIntegrityKind, 'zero_modified_files');
  assert.equal(output.metadata.markerOnlyProductDelta, false);
  assert.equal(fs.existsSync(path.join(workspacePath, fullCloneLeafPath)), false, 'worker must not create an isolated remediation module when primary adoption files are provided');
});

test('implement worker: continuation remediation runs canonical product work before marking the leaf satisfied', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/routes/api-admin.mjs'
  ], {
    shardId: 'focus.api_keys_webhooks::continuation-024#3',
    campaign: { requestedFidelity: 'full_clone' },
    issue: { inputs: { focusGroup: 'api_keys_webhooks' } },
    shard: {
      id: 'focus.api_keys_webhooks::continuation-024#3',
      surfaceIds: ['api_keys_webhooks'],
      allowedFiles: ['packages/app/routes/api-admin.mjs'],
      metadata: {
        remediationLeafId: 'focus.api_keys_webhooks::continuation-024#3',
        structuralLeafId: 'focus.api_keys_webhooks::continuation-024#3',
        frontierLeafId: 'focus.api_keys_webhooks::continuation-024#3',
        strictGap: true,
        structuralFullClone: true,
        frontierFullClone: true,
        remediationFullClone: true,
        continuationFullClone: true,
        continuationWaveIndex: 24,
        structuralPhaseId: 'continuation_wave_024_database_transaction_model',
        structuralPhaseTitle: 'continuation wave 024 — database transaction model',
        sourceProductFile: 'packages/app/routes/api-admin.mjs',
        primaryProductAdoptionRequired: true,
        primaryAdoptionFiles: ['packages/app/routes/api-admin.mjs']
      }
    }
  });
  const apiAdmin = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/api-admin.mjs'), 'utf8');
  assert.deepEqual(output.modifiedFiles, ['packages/app/routes/api-admin.mjs']);
  assert.equal(output.metadata.claimIntegrityKind, 'substantive_product_delta', 'real canonical route work plus evidence marker should remain substantive');
  assert.equal(output.metadata.markerOnlyProductDelta, false);
  assert.match(apiAdmin, /router\.register\('GET', '\/api\/developer\/access'/, 'continuation work must land the canonical API/webhook product route');
  assert.doesNotMatch(apiAdmin, /full_clone_remediation_leaf_evaluated|"fidelity": "full_clone"|"requirements": \[/, 'continuation work must not append strict remediation marker/blueprint bulk after product work');
});

test('implement worker: semantic director shards derive their focus id and emit in-scope primary runtime deltas when canonical work is already saturated', () => {
  const { workspacePath, output } = runAssignment([
    'surface-honesty.json',
    'packages/app/domain-commerce-revenue.mjs',
    'packages/app/routes/api-admin.mjs'
  ], {
    shardId: 'focus.semantic_director_regression::semantic-frontier-001#09-integrated_user_path_evidence',
    inputs: {
      focusId: 'focus.semantic_director_regression',
      surfaceId: 'semantic_director_regression',
      semanticPhaseId: 'integrated_user_path_evidence',
      semanticIntent: 'Ensure the semantic director regression surface is adopted by a real app path with executable verifier coverage.'
    },
    issue: { inputs: { focusGroup: 'unknown' } },
    shard: {
      id: 'focus.semantic_director_regression::semantic-frontier-001#09-integrated_user_path_evidence',
      allowedFiles: ['packages/app/domain-commerce-revenue.mjs', 'packages/app/routes/api-admin.mjs'],
      metadata: {
        focusId: 'focus.semantic_director_regression',
        rootFocusId: 'focus.semantic_director_regression',
        surfaceId: 'semantic_director_regression',
        focusGroup: 'unknown',
        semanticDirector: true,
        architectureFrontier: true,
        semanticPhaseId: 'integrated_user_path_evidence',
        primaryProductAdoptionRequired: true,
        primaryAdoptionFiles: ['packages/app/domain-commerce-revenue.mjs', 'packages/app/routes/api-admin.mjs']
      }
    }
  }, { source: 'working-tree' });
  const apiAdmin = fs.readFileSync(path.join(workspacePath, 'packages/app/routes/api-admin.mjs'), 'utf8');
  assert.equal(output.surfaceFocusId, 'semantic_director_regression');
  assert.ok(output.modifiedFiles.length >= 1, 'semantic director shard should produce an admissible primary product diff after saturated canonical work');
  assert.ok(output.modifiedFiles.every((filePath) => ['packages/app/domain-commerce-revenue.mjs', 'packages/app/routes/api-admin.mjs'].includes(filePath)), 'semantic director fallback must stay inside the assignment contract target files');
  assert.doesNotMatch(output.modifiedFiles.join('\n'), /^apps\//m, 'semantic director fallback must not escape into generic frontend shell files');
  assert.match(apiAdmin, /semanticDirectorRegressionIntegratedUserPathEvidenceSemanticRuntimeContract/, 'semantic runtime evidence should land in a primary runtime file');
  assert.match(apiAdmin, /semantic_frontier_product_runtime_evaluated/, 'semantic runtime evidence should expose executable product-state evaluation');
});

test('implement worker: saturated reports overview semantic user-path shard lands a domain-layer delta instead of repeating a route-only no-op', () => {
  const { workspacePath, output } = runAssignment([
    'surface-honesty.json',
    'packages/app/domain-growth.mjs',
    'packages/app/domain-commerce-revenue.mjs',
    'packages/app/routes/api-admin.mjs',
    'packages/app/routes/reports.mjs'
  ], {
    shardId: 'focus.reports_overview::semantic-frontier-001#18-integrated_user_path_evidence',
    inputs: {
      focusId: 'focus.reports_overview',
      surfaceId: 'reports_overview',
      semanticPhaseId: 'integrated_user_path_evidence',
      semanticIntent: 'Ensure reports overview is adopted by a real app path with executable verifier coverage.'
    },
    issue: { inputs: { focusGroup: 'frontend_architecture' } },
    shard: {
      id: 'focus.reports_overview::semantic-frontier-001#18-integrated_user_path_evidence',
      allowedFiles: [
        'packages/app/domain-growth.mjs',
        'packages/app/domain-commerce-revenue.mjs',
        'packages/app/routes/api-admin.mjs',
        'packages/app/routes/reports.mjs'
      ],
      metadata: {
        focusId: 'focus.reports_overview',
        rootFocusId: 'focus.reports_overview',
        surfaceId: 'reports_overview',
        focusGroup: 'frontend_architecture',
        semanticDirector: true,
        architectureFrontier: true,
        semanticPhaseId: 'integrated_user_path_evidence',
        primaryProductAdoptionRequired: true,
        primaryAdoptionFiles: [
          'packages/app/domain-growth.mjs',
          'packages/app/domain-commerce-revenue.mjs',
          'packages/app/routes/api-admin.mjs',
          'packages/app/routes/reports.mjs'
        ]
      }
    },
    contextPack: {
      shard: {
        id: 'focus.reports_overview::semantic-frontier-001#18-integrated_user_path_evidence',
        surfaceIds: ['reports_overview']
      },
      guardrails: {
        allowedFiles: [
          'packages/app/domain-growth.mjs',
          'packages/app/domain-commerce-revenue.mjs',
          'packages/app/routes/api-admin.mjs',
          'packages/app/routes/reports.mjs'
        ]
      }
    }
  }, { source: 'working-tree' });
  const changedText = output.modifiedFiles.map((filePath) => fs.readFileSync(path.join(workspacePath, filePath), 'utf8')).join('\n');
  assert.equal(output.surfaceFocusId, 'reports_overview');
  assert.ok(output.modifiedFiles.length >= 1, 'saturated reports overview semantic shard should still land a product diff');
  assert.ok(output.modifiedFiles.some((filePath) => /packages\/app\/domain-(?:growth|commerce-revenue)\.mjs$/.test(filePath)), 'saturated reports overview user-path work should modify a domain layer instead of only report/API routes');
  assert.equal(output.metadata.architectureEvidence.ok, true, 'reports overview semantic retry should satisfy architecture admission after adding domain-layer target coverage');
  assert.deepEqual(output.metadata.architectureEvidence.requiredLayers, ['route_or_server', 'domain_or_persistence']);
  assert.match(changedText, /reportsOverviewIntegratedUserPathEvidenceSemanticRuntimeContract/, 'domain-layer delta should carry the reports overview semantic runtime contract');
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


test('implement worker: benchmark-scoped remaining surfaces do not emit benchmark-only density wrappers', () => {
  const surfaces = {
    frontend_client_shell_state: ['apps/web/server.mjs', 'packages/app/view.mjs', 'packages/app/routes/platform.mjs'],
    website_builder_editor_realism: ['packages/app/domain-website-builder.mjs', 'packages/app/routes/website-builder.mjs'],
    automation_journey_execution: ['packages/app/domain-campaigns.mjs', 'packages/app/routes/automations.mjs'],
    audience_identity_lifecycle: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'],
    reporting_metrics_pipeline: ['packages/app/domain-commerce-revenue.mjs', 'packages/app/routes/reports.mjs'],
    integration_provider_sync: ['packages/app/domain-integration-marketplace.mjs', 'packages/app/routes/integrations-marketplace.mjs'],
    auth_session_security_hardening: ['packages/app/routes/public.mjs', 'packages/trust-automation/domain-trust-automation.mjs', 'packages/trust-automation/routes/trust-automation-api.mjs'],
    persistence_jobs_operational_db: ['packages/app/jobs.mjs', 'packages/app/storage.mjs'],
    ai_predictive_ops_realism: ['packages/app/domain-current-product-ops.mjs', 'packages/app/routes/current-product-ops.mjs', 'packages/app/routes/current-product-parity.mjs']
  };

  for (const [surfaceId, allowedFiles] of Object.entries(surfaces)) {
    const { workspacePath, output } = runAssignment(allowedFiles, {
      shardId: `focus.${surfaceId}`,
      shard: {
        id: `focus.${surfaceId}`,
        title: `${surfaceId} parity`,
        lane: 'benchmark_scope_regression',
        allowedFiles,
        surfaceIds: [surfaceId]
      },
      contextPack: {
        shard: {
          id: `focus.${surfaceId}`,
          title: `${surfaceId} parity`,
          lane: 'benchmark_scope_regression',
          surfaceIds: [surfaceId]
        },
        guardrails: { allowedFiles },
        assignmentContract: { targetFiles: allowedFiles }
      }
    });
    assert.equal(output.surfaceFocusId, surfaceId);
    assert.ok(output.modifiedFiles.every((filePath) => allowedFiles.includes(filePath)), `${surfaceId} should stay within allowed files`);
    const changedText = output.modifiedFiles.map((filePath) => fs.readFileSync(path.join(workspacePath, filePath), 'utf8')).join('\n');
    assert.doesNotMatch(changedText, /mailchimp_product_density_|ProductDensity|high_density_mailchimp_product_surface|mailchimpHighDensityProduct|mailchimp_surface_grounding_|SurfaceGrounding/, `${surfaceId} should not add benchmark-only helper wrappers`);
  }
});

test('implement worker: semantic director operational persistence shards modify a jobs runtime layer', () => {
  const { workspacePath, output } = runAssignment([
    'surface-honesty.json',
    'packages/app/domain-growth.mjs',
    'packages/app/routes/forms.mjs',
    'packages/app/jobs.mjs',
    'packages/app/job-runtime.mjs',
    'packages/app/job-handlers.mjs',
    'packages/app/persistence-io.mjs',
    'packages/app/storage.mjs'
  ], {
    shardId: 'focus.signup_forms_popups::semantic-frontier-001#07-operational_persistence_and_jobs',
    inputs: {
      focusId: 'focus.signup_forms_popups',
      surfaceId: 'signup_forms_popups',
      semanticPhaseId: 'operational_persistence_and_jobs',
      semanticIntent: 'Connect signup forms to durable persistence and background jobs.'
    },
    issue: { inputs: { focusGroup: 'forms_growth' } },
    shard: {
      id: 'focus.signup_forms_popups::semantic-frontier-001#07-operational_persistence_and_jobs',
      allowedFiles: [
        'packages/app/domain-growth.mjs',
        'packages/app/routes/forms.mjs',
        'packages/app/jobs.mjs',
        'packages/app/job-runtime.mjs',
        'packages/app/job-handlers.mjs',
        'packages/app/persistence-io.mjs',
        'packages/app/storage.mjs'
      ],
      metadata: {
        focusId: 'focus.signup_forms_popups',
        rootFocusId: 'focus.signup_forms_popups',
        surfaceId: 'signup_forms_popups',
        focusGroup: 'forms_growth',
        semanticDirector: true,
        architectureFrontier: true,
        semanticPhaseId: 'operational_persistence_and_jobs',
        primaryProductAdoptionRequired: true,
        primaryAdoptionFiles: [
          'packages/app/domain-growth.mjs',
          'packages/app/routes/forms.mjs',
          'packages/app/jobs.mjs',
          'packages/app/job-runtime.mjs',
          'packages/app/job-handlers.mjs',
          'packages/app/persistence-io.mjs',
          'packages/app/storage.mjs'
        ]
      }
    }
  }, { source: 'working-tree' });
  const jobRuntimeTouched = output.modifiedFiles.some((filePath) => /packages\/app\/(?:jobs|job-runtime|job-handlers)\.mjs$/.test(filePath));
  assert.ok(jobRuntimeTouched, `expected a jobs runtime file in modifiedFiles, got ${output.modifiedFiles.join(', ')}`);
  assert.equal(output.metadata.architectureEvidence.ok, true);
  assert.ok(output.metadata.architectureEvidence.layers.includes('jobs_runtime'));
  assert.ok(output.metadata.architectureEvidence.presentRequiredLayers.includes('jobs_runtime'));
  const touchedJobRuntime = output.modifiedFiles.find((filePath) => /packages\/app\/(?:jobs|job-runtime|job-handlers)\.mjs$/.test(filePath));
  const jobSource = fs.readFileSync(path.join(workspacePath, touchedJobRuntime), 'utf8');
  assert.match(jobSource, /semantic_frontier_product_runtime_evaluated/);
});

test('implement worker: settings domains integrated user-path shards keep a domain/persistence adoption layer', () => {
  const { workspacePath, output } = runAssignment([
    'packages/app/domain-deliverability-compliance.mjs',
    'packages/app/routes/api-admin.mjs',
    'packages/app/routes/platform.mjs'
  ], {
    shardId: 'focus.settings_domains::semantic-frontier-001#10-integrated_user_path_evidence',
    inputs: {
      focusId: 'focus.settings_domains',
      surfaceId: 'settings_domains',
      semanticPhaseId: 'integrated_user_path_evidence',
      semanticIntent: 'Ensure settings and domain authentication are adopted by a real app path with executable verifier coverage.'
    },
    issue: { inputs: { focusGroup: 'frontend_architecture' } },
    shard: {
      id: 'focus.settings_domains::semantic-frontier-001#10-integrated_user_path_evidence',
      allowedFiles: [
        'packages/app/domain-deliverability-compliance.mjs',
        'packages/app/routes/api-admin.mjs',
        'packages/app/routes/platform.mjs'
      ],
      metadata: {
        focusId: 'focus.settings_domains',
        rootFocusId: 'focus.settings_domains',
        surfaceId: 'settings_domains',
        focusGroup: 'frontend_architecture',
        semanticDirector: true,
        architectureFrontier: true,
        semanticPhaseId: 'integrated_user_path_evidence',
        primaryProductAdoptionRequired: true,
        primaryAdoptionFiles: [
          'packages/app/domain-deliverability-compliance.mjs',
          'packages/app/routes/api-admin.mjs',
          'packages/app/routes/platform.mjs'
        ]
      }
    }
  }, { source: 'working-tree' });
  assert.equal(output.metadata.architectureEvidence.ok, true);
  assert.ok(output.metadata.architectureEvidence.presentRequiredLayers.includes('route_or_server'));
  assert.ok(output.metadata.architectureEvidence.presentRequiredLayers.includes('domain_or_persistence'));
  assert.ok(output.modifiedFiles.includes('packages/app/domain-deliverability-compliance.mjs'), `expected settings/domain semantic user-path work to modify the domain layer, got ${output.modifiedFiles.join(', ')}`);
  const domainSource = fs.readFileSync(path.join(workspacePath, 'packages/app/domain-deliverability-compliance.mjs'), 'utf8');
  assert.match(domainSource, /settingsDomainsIntegratedUserPathEvidenceSemanticRuntimeContract/);
  assert.match(domainSource, /semantic_frontier_product_runtime_evaluated/);
});

test('implement worker: saturated signup onboarding semantic primary spine adopts storage persistence layer', () => {
  const { workspacePath, output } = runAssignment([
    'surface-honesty.json',
    'packages/app/index.mjs',
    'packages/app/routes/public.mjs',
    'packages/app/routes/platform.mjs',
    'packages/app/view.mjs',
    'packages/app/storage.mjs',
    'packages/app/persistence-io.mjs'
  ], {
    shardId: 'focus.signup_onboarding::semantic-frontier-001#07-primary_runtime_spine',
    inputs: {
      focusId: 'focus.signup_onboarding',
      surfaceId: 'signup_onboarding',
      semanticPhaseId: 'primary_runtime_spine',
      semanticIntent: 'Adopt signup onboarding into primary runtime and persistence state.'
    },
    issue: { inputs: { focusGroup: 'frontend_architecture' } },
    shard: {
      id: 'focus.signup_onboarding::semantic-frontier-001#07-primary_runtime_spine',
      allowedFiles: [
        'packages/app/index.mjs',
        'packages/app/routes/public.mjs',
        'packages/app/routes/platform.mjs',
        'packages/app/view.mjs',
        'packages/app/storage.mjs',
        'packages/app/persistence-io.mjs'
      ],
      metadata: {
        focusId: 'focus.signup_onboarding',
        rootFocusId: 'focus.signup_onboarding',
        surfaceId: 'signup_onboarding',
        focusGroup: 'frontend_architecture',
        semanticDirector: true,
        architectureFrontier: true,
        semanticPhaseId: 'primary_runtime_spine',
        primaryProductAdoptionRequired: true,
        primaryAdoptionFiles: [
          'packages/app/index.mjs',
          'packages/app/routes/public.mjs',
          'packages/app/routes/platform.mjs',
          'packages/app/view.mjs',
          'packages/app/storage.mjs',
          'packages/app/persistence-io.mjs'
        ]
      }
    }
  }, { source: 'working-tree' });
  assert.equal(output.metadata.architectureEvidence.ok, true);
  assert.ok(output.metadata.architectureEvidence.presentRequiredLayers.includes('domain_or_persistence'));
  assert.ok(output.metadata.architectureEvidence.presentRequiredLayers.includes('route_or_server'));
  assert.ok(output.modifiedFiles.some((filePath) => /packages\/app\/(?:storage|persistence-io)\.mjs$/.test(filePath)), `expected storage/persistence modified file, got ${output.modifiedFiles.join(', ')}`);
  const persistenceFile = output.modifiedFiles.find((filePath) => /packages\/app\/(?:storage|persistence-io)\.mjs$/.test(filePath));
  const persistenceSource = fs.readFileSync(path.join(workspacePath, persistenceFile), 'utf8');
  assert.match(persistenceSource, /signupOnboardingPrimaryRuntimeSpineSemanticRuntimeContract/);
});
