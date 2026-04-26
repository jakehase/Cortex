import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createCompletionIntegrityEngine } from './core.mjs';

function makeHarness(opts = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-integrity-'));
  const workspaceRoot = opts.config?.workspaceRoot || path.join(stateDir, 'workspace');
  let now = Date.parse('2026-03-19T16:00:00.000Z');
  const deliveries = [];
  const engine = createCompletionIntegrityEngine({ stateDir, workspaceRoot, autoDeliveryAfterMs: 1000, retryBackoffMs: 1000, pollIntervalMs: 1000, escalationAfterMs: 2000, ...opts.config }, {
    clock: () => now,
    isoNow: () => new Date(now).toISOString(),
    logger: { warn() {}, info() {} },
    deliver: async (payload) => { deliveries.push(payload); return { ok: true }; },
  });
  return {
    stateDir,
    workspaceRoot,
    deliveries,
    engine,
    tick(ms) { now += ms; },
    task() { return engine.loadStore().tasks.at(-1); },
    metrics() { return engine.loadMetrics(); },
  };
}

function ctx(sessionKey = 'agent:main:whatsapp:direct:+1') {
  return { sessionKey, channelId: 'whatsapp', accountId: 'acct-1', conversationId: 'conv-1' };
}

function makeHonestyRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'honesty-repo-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  for (const folder of ['packages/app', 'tests', 'docs', 'artifacts']) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'packages/app/index.mjs'), 'export const feature = true;\n');
  fs.writeFileSync(path.join(dir, 'tests/smoke.test.mjs'), 'export const ok = true;\n');
  return dir;
}

function makeClaimIntegritySupervisorArtifacts(root) {
  const dir = path.join(root, 'artifacts', 'claim-integrity-supervisor');
  fs.mkdirSync(dir, { recursive: true });

  const surfaces = Array.from({ length: 10 }, (_, index) => {
    const id = `S${index + 1}`;
    const artifactPath = path.join(dir, `${id}.json`);
    if (index === 0 || index === 1) fs.writeFileSync(artifactPath, JSON.stringify({ ok: true }, null, 2));
    const status = index === 0 ? 'all_complete' : index === 1 ? 'partial' : 'partial';
    const issueStatus = index === 0 ? 'complete' : index === 1 ? 'in_progress' : 'pending';
    return {
      id,
      label: `Surface ${index + 1}`,
      status,
      artifactsPresent: index <= 1,
      requiredArtifacts: index <= 1 ? [artifactPath] : [path.join(dir, `${id}-missing.json`)],
      issues: [
        {
          id: `${id}.issue`,
          title: `Surface ${index + 1} issue`,
          status: issueStatus,
          artifacts: index <= 1 ? [artifactPath] : [path.join(dir, `${id}-missing.json`)],
          notes: issueStatus === 'complete' ? 'validated by supervisor artifacts' : 'supervisor still marks this surface incomplete'
        }
      ]
    };
  });

  const matrixPath = path.join(dir, 'surface_matrix.json');
  fs.writeFileSync(matrixPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    contractSummary: {
      targetPath: root,
      requestedFidelity: 'parity_for_scope',
      requestedScope: 'Roadmap progress'
    },
    status: 'partial',
    surfaces
  }, null, 2));

  const recoveryPath = path.join(dir, 'recovery_simulation.json');
  fs.writeFileSync(recoveryPath, JSON.stringify({ ok: true }, null, 2));

  const programStatePath = path.join(dir, 'program_state.json');
  fs.writeFileSync(programStatePath, JSON.stringify({
    mode: 'persistent',
    worker: { steps: [{ id: 'run.start', ok: true }, { id: 'run.progress', ok: true }] },
    supervisor: { status: 'red', blocker: 'provider offline', matrixStatus: 'partial' },
    notifier: { delivered: false },
    evidence: { recoveryPath }
  }, null, 2));

  return { matrixPath, programStatePath };
}

function replyPrompt(userText, repliedBody, extra = {}) {
  const fence = '```';
  return `Conversation info (untrusted metadata):\n${fence}json\n${JSON.stringify({ message_id: 'm-current', sender_id: '+1', sender: 'Jake', has_reply_context: true, reply_to_id: 'm-anchor', ...extra }, null, 2)}\n${fence}\n\nReplied message (untrusted, for context):\n${fence}json\n${JSON.stringify({ sender_label: 'assistant', body: repliedBody }, null, 2)}\n${fence}\n\n${userText}`;
}

test('tracks hard state machine through completion, send, confirmation, and close', async () => {
  const h = makeHarness();
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx());
  h.engine.onBeforePromptBuild({ prompt: 'Implement the delivery confirmation hardening' }, ctx());
  assert.equal(h.task().status, 'running');

  h.engine.onAgentEnd({ success: true, result: 'Anchor: plugins/completion-integrity/core.mjs Target path: /root/clawd/plugins/completion-integrity Fidelity: production_slice Scope: delivery confirmation hardening Stop condition: completed_and_delivered Diff scope: product files: core.mjs and tests; Implemented hardening and tests pass' }, ctx());
  assert.equal(h.task().status, 'internal_complete');
  assert.equal(h.task().validation.passed, true);

  h.tick(1500);
  await h.engine.autoDeliverCompletedTasks({});
  assert.equal(h.task().status, 'notification_sent');
  assert.equal(h.deliveries.length, 1);

  h.engine.onMessageSent({ content: 'Done: Implemented hardening and tests pass' }, ctx());
  assert.equal(h.task().status, 'closed');
  assert.ok(h.task().deliveryConfirmedAt);
  assert.ok(h.metrics().completion_to_delivery_confirmed_latency_ms.length >= 1);
});

test('important tasks require validator pass before auto-delivery', async () => {
  const h = makeHarness({ config: { validationMode: 'important_only' } });
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx());
  h.engine.onBeforePromptBuild({ prompt: 'Deploy and verify the restart recovery patch' }, ctx());
  const taskId = h.task().id;
  h.engine.completeInternally(taskId, 'failed');
  h.engine.runValidator(taskId, { source: 'manual' });
  assert.equal(h.task().validation.passed, false);

  h.tick(1500);
  await h.engine.autoDeliverCompletedTasks({});
  assert.equal(h.deliveries.length, 0);
  assert.equal(h.task().status, 'internal_complete');

  h.engine.completeInternally(taskId, 'Anchor: deploy/restart recovery contract Target path: /root/clawd/plugins/completion-integrity Fidelity: production_slice Scope: restart recovery patch Stop condition: completed_and_delivered Diff scope: product files: core.mjs and tests; deploy patch validated with restart evidence');
  h.engine.runValidator(taskId, { source: 'manual-2' });
  assert.equal(h.task().validation.passed, true);
  h.tick(1500);
  await h.engine.autoDeliverCompletedTasks({});
  assert.equal(h.deliveries.length, 1);
  assert.equal(h.task().status, 'notification_sent');
});

test('important implementation tasks inject objective grounding guidance and require grounding proof', async () => {
  const h = makeHarness({ config: { validationMode: 'important_only' } });
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-g'));
  h.engine.onBeforePromptBuild({ prompt: 'Do it — implement phases 1-3 from the previous roadmap' }, ctx('sess-g'));
  const injection = h.engine.buildPromptInjection('sess-g');
  assert.match(injection.appendSystemContext, /OBJECTIVE_GROUNDING/);
  assert.match(injection.appendSystemContext, /Anchor:/);
  assert.match(injection.appendSystemContext, /Target path:/);
  assert.match(injection.appendSystemContext, /scaffolding only/);
  assert.equal(h.task().grounding.required, true);
  assert.equal(h.task().grounding.ambiguousReference, true);

  h.engine.onAgentEnd({ success: true, result: 'Target path: /root/clawd/mailchimp-clone. Fidelity: production_slice. Scope: phases 1-3 roadmap follow-up. Stop condition: supervisor_green_or_blocker_report. Surface matrix: artifacts/roadmap.json. Surface matrix status: all_complete. Campaign mode: persistent. Supervisor status: green. Implemented the roadmap and tests passed' }, ctx('sess-g'));
  assert.equal(h.task().validation.passed, false);
  assert.equal(h.task().validation.failures.at(-1).reason, 'objective_grounding_proof_missing');

  h.engine.completeInternally(h.task().id, 'Anchor: docs/MAILCHIMP_PARITY_PROGRAM_0_FINAL_REPORT_2026-04-01.md Target path: /root/clawd/public/cortex_server Fidelity: production_slice Scope: phases 1-3 roadmap follow-up Stop condition: supervisor_green_or_blocker_report Surface matrix: artifacts/roadmap.json Surface matrix status: all_complete Campaign mode: persistent Supervisor status: green Diff scope: scaffolding only; no product files changed');
  h.engine.runValidator(h.task().id, { source: 'manual-grounded' });
  assert.equal(h.task().validation.passed, true);
  assert.equal(h.task().grounding.proofPresent, true);
});

test('global honesty gate blocks completion until target repo declares changed real surfaces', () => {
  const repo = makeHonestyRepo();
  const h = makeHarness({ config: { validationMode: 'important_only' } });
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-honesty'));
  h.engine.onBeforePromptBuild({ prompt: 'Implement the real product fix in the shared repo' }, ctx('sess-honesty'));

  const injection = h.engine.buildPromptInjection('sess-honesty');
  assert.match(injection.appendSystemContext, /HONESTY_GATE/);
  assert.equal(h.task().honesty.required, true);

  h.engine.onAgentEnd({ success: true, result: `Anchor: honesty policy. Target path: ${repo}. Fidelity: production_slice. Scope: product surface fix. Stop condition: completed_and_delivered. Diff scope: product files: packages/app/index.mjs.` }, ctx('sess-honesty'));
  assert.equal(h.task().validation.passed, false);
  assert.equal(fs.existsSync(path.join(repo, 'surface-honesty.json')), true);
  assert.equal(h.task().validation.failures.at(-1).reason, 'surface-honesty-status');
  assert.equal(h.task().honesty.status, 'red');
  assert.equal(h.task().honesty.bootstrapCreated, true);

  const blockedSend = h.engine.onMessageSending({ to: '+1', content: 'Done: shipped the implementation' }, ctx('sess-honesty'));
  assert.match(blockedSend.content, /Completion claim withheld:/);

  const blockedPersist = h.engine.onBeforeMessageWriteGuard({ message: { role: 'assistant', content: 'Done: shipped the implementation' }, sessionKey: 'sess-honesty' }, ctx('sess-honesty'));
  assert.match(blockedPersist.message.content, /Completion claim withheld:/);

  fs.writeFileSync(path.join(repo, 'surface-honesty.json'), JSON.stringify({
    version: 1,
    surfaces: {
      'packages/app/index.mjs': {
        label: 'Shared app entry surface',
        status: 'real',
        evidence: { tests: ['tests/smoke.test.mjs'] }
      }
    }
  }, null, 2));

  h.engine.completeInternally(h.task().id, `Anchor: honesty policy. Target path: ${repo}. Fidelity: production_slice. Scope: product surface fix. Stop condition: completed_and_delivered. Diff scope: product files: packages/app/index.mjs. Honesty manifest: ${path.join(repo, 'surface-honesty.json')}. Honesty gate: green. Changed product surfaces: packages/app/index.mjs. Honesty evidence: tests/smoke.test.mjs.`);
  h.engine.runValidator(h.task().id, { source: 'manual-honesty-pass' });
  assert.equal(h.task().validation.passed, true);
  assert.equal(h.task().honesty.status, 'green');
  assert.equal(h.task().honesty.changedProductFiles.includes('packages/app/index.mjs'), true);
});

test('explicit honesty override artifact allows completion claims to pass and leave the system', () => {
  const repo = makeHonestyRepo();
  const h = makeHarness({ config: { validationMode: 'important_only' } });
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-override'));
  h.engine.onBeforePromptBuild({ prompt: 'Implement the real product fix in the shared repo' }, ctx('sess-override'));

  fs.mkdirSync(path.join(repo, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'artifacts', 'honesty-override.json'), JSON.stringify({
    allowCompletionClaim: true,
    approvedBy: 'Jake',
    reason: 'Temporary emergency override for a hotfix while honesty manifest is being finalized.'
  }, null, 2));

  h.engine.onAgentEnd({ success: true, result: `Anchor: override policy. Target path: ${repo}. Fidelity: production_slice. Scope: emergency product fix. Stop condition: completed_and_delivered. Diff scope: product files: packages/app/index.mjs. Honesty override: ${path.join(repo, 'artifacts', 'honesty-override.json')}.` }, ctx('sess-override'));
  assert.equal(h.task().validation.passed, true);
  assert.equal(h.task().honesty.status, 'override');
  assert.equal(h.task().honesty.overrideApprovedBy, 'Jake');

  const allowedSend = h.engine.onMessageSending({ to: '+1', content: 'Done: emergency product fix shipped' }, ctx('sess-override'));
  assert.equal(allowedSend, undefined);
});

test('reply-thread grounding treats replied message as primary anchor and requires explicit reply-anchor proof', () => {
  const h = makeHarness({ config: { validationMode: 'important_only' } });
  const prompt = replyPrompt(
    'Continue phases 1-3 in one pass',
    'Program 1 — Platform spine; Program 2 — Audience/contact core; Program 3 — Campaign/editor/send pipeline'
  );
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-reply'));
  h.engine.onBeforePromptBuild({ prompt }, ctx('sess-reply'));

  const injection = h.engine.buildPromptInjection('sess-reply');
  assert.match(injection.appendSystemContext, /REPLY_THREAD_GROUNDING/);
  assert.match(injection.appendSystemContext, /Program 1 — Platform spine/);
  assert.match(injection.appendSystemContext, /Reply anchor:/);
  assert.equal(h.task().grounding.replyThread.present, true);
  assert.equal(h.task().grounding.replyThread.required, true);
  assert.equal(h.task().prompt, 'Continue phases 1-3 in one pass');

  h.engine.onAgentEnd({ success: true, result: 'Anchor: replied roadmap message Target path: /root/clawd/mailchimp-clone Diff scope: product files: app and api' }, ctx('sess-reply'));
  assert.equal(h.task().validation.passed, false);
  assert.equal(h.task().validation.failures.at(-1).reason, 'reply_thread_anchor_missing');

  h.engine.completeInternally(h.task().id, 'Reply anchor: Program 1 platform spine / Program 2 audience-contact core / Program 3 campaign-editor-send pipeline. Anchor: replied roadmap message. Target path: /root/clawd/mailchimp-clone. Fidelity: production_slice. Scope: Programs 1-3. Stop condition: supervisor_green_or_blocker_report. Surface matrix: artifacts/surfaces.json. Surface matrix status: all_complete. Campaign mode: persistent. Supervisor status: green. Diff scope: product files: app and api.');
  h.engine.runValidator(h.task().id, { source: 'manual-reply-anchor' });
  assert.equal(h.task().validation.passed, true);
  assert.equal(h.task().grounding.replyThread.proofPresent, true);
});

test('conversational reply questions still get reply-thread grounding and auto-promote high-signal anchor memory', () => {
  const h = makeHarness();
  const prompt = replyPrompt(
    'That’s actually for this, how come you weren’t able to deduct that from memory?',
    `[Cortex] Mailchimp remediated-run takeaway: the architecture is finally giving us a trustworthy result.\n\nFor the current run:\n- supervisorStatus: red\n- matrixStatus: partial\n- parityStatus: partial\n- blocker: null\n\nExactly which remaining surfaces are still not satisfied\n- C_data_model_and_persistence_parity\n- E_reporting_analytics_parity\n- F_ai_predictive_optimization_parity\n\nMost important structural insight\n- Persistence first.\n- Reply-anchor context should be treated as primary.`
  );

  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-memory'));
  const injection = h.engine.onBeforePromptBuild({ prompt }, ctx('sess-memory'));

  assert.equal(h.engine.loadStore().tasks.length, 0);
  assert.match(injection.appendSystemContext, /REPLY_THREAD_GROUNDING/);
  assert.match(injection.appendSystemContext, /reply-anchor context first/i);

  const memoryFile = path.join(h.workspaceRoot, 'memory', '2026-03-19.md');
  const memoryText = fs.readFileSync(memoryFile, 'utf8');
  assert.match(memoryText, /Auto-promoted reply-anchor memory:/);
  assert.match(memoryText, /supervisorStatus=red/);
  assert.match(memoryText, /C_data_model_and_persistence_parity/);

  const projectFile = path.join(h.workspaceRoot, 'memory', 'projects', 'mailchimp.md');
  const projectText = fs.readFileSync(projectFile, 'utf8');
  assert.match(projectText, /# Mailchimp project memory/);
  assert.match(projectText, /supervisorStatus: red/);
  assert.match(projectText, /C_data_model_and_persistence_parity/);
  assert.match(projectText, /reply-anchor context should be treated as primary/i);

  h.engine.onBeforePromptBuild({ prompt }, ctx('sess-memory'));
  const dedupedText = fs.readFileSync(memoryFile, 'utf8');
  assert.equal((dedupedText.match(/Auto-promoted reply-anchor memory:/g) || []).length, 1);

  const dedupedProjectText = fs.readFileSync(projectFile, 'utf8');
  assert.equal((dedupedProjectText.match(/## Recent promotions/g) || []).length, 1);
});

test('1:1 clone requests require full-parity proof and reject prototype-style completions', () => {
  const h = makeHarness({ config: { validationMode: 'important_only' } });
  const prompt = 'Build a 1:1 clone of Mailchimp for programs 1-3';
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-clone'));
  h.engine.onBeforePromptBuild({ prompt }, ctx('sess-clone'));

  const injection = h.engine.buildPromptInjection('sess-clone');
  assert.match(injection.appendSystemContext, /CLONE_PARITY_CONTRACT/);
  assert.match(injection.appendSystemContext, /parity-first, not MVP-first/);
  assert.equal(h.task().cloneParity.required, true);

  h.engine.onAgentEnd({ success: true, result: 'Anchor: roadmap Target path: /root/clawd/mailchimp-clone Fidelity: full_clone Scope: Programs 1-3 Stop condition: supervisor_green_or_blocker_report Surface matrix: artifacts/surface_matrix.json Surface matrix status: all_complete Campaign mode: persistent Supervisor status: green Diff scope: product files: app and api. Prototype first-pass vertical slice implemented.' }, ctx('sess-clone'));
  assert.equal(h.task().validation.passed, false);
  assert.equal(h.task().validation.failures.at(-1).reason, 'clone_parity_proof_missing_or_partial');

  h.engine.completeInternally(h.task().id, 'Anchor: roadmap. Target path: /root/clawd/mailchimp-clone. Fidelity: full_clone. Scope: Programs 1-3. Stop condition: supervisor_green_or_blocker_report. Surface matrix: artifacts/surface_matrix.json. Surface matrix status: all_complete. Campaign mode: persistent. Supervisor status: green. Diff scope: product files: app and api. Parity status: full. Surface coverage: Program 1 platform spine, Program 2 audience/contact core, Program 3 campaign/editor/send pipeline. Parity evidence: browser checks, API tests, workflow tests, send/review checks. Remaining gaps: none beyond minor polish.');
  h.engine.runValidator(h.task().id, { source: 'manual-clone-parity' });
  assert.equal(h.task().validation.passed, true);
  assert.equal(h.task().cloneParity.proofPresent, true);
});

test('progress estimate prompts inject claim-integrity guidance and reject unsupported percentage claims', () => {
  const h = makeHarness({ config: { validationMode: 'important_only' } });
  const prompt = 'What percentage complete is the roadmap project right now?';
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-claim-integrity'));
  h.engine.onBeforePromptBuild({ prompt }, ctx('sess-claim-integrity'));
  const store = h.engine.loadStore();
  store.tasks.at(-1).contract.required = false;
  store.tasks.at(-1).campaign.required = false;
  store.tasks.at(-1).surfaceMatrix.required = false;
  store.tasks.at(-1).cloneParity.required = false;
  store.tasks.at(-1).honesty.required = false;
  store.tasks.at(-1).grounding.required = false;
  store.tasks.at(-1).grounding.replyThread.required = false;
  fs.writeFileSync(h.engine.paths.tasks, JSON.stringify(store, null, 2));

  const injection = h.engine.buildPromptInjection('sess-claim-integrity');
  assert.ok(injection);
  assert.match(injection.appendSystemContext, /CLAIM_INTEGRITY/);
  assert.equal(h.task().claimIntegrity.required, true);

  h.engine.onAgentEnd({ success: true, result: 'Estimated: about 40% done on the roadmap project.' }, ctx('sess-claim-integrity'));
  assert.equal(h.task().validation.passed, false);
  assert.equal(h.task().validation.failures.at(-1).reason, 'claim_integrity_progress_estimate_unbacked');

  h.engine.completeInternally(h.task().id, [
    'Observed: execution readiness is stronger than product parity.',
    'Estimated: clone parity is 5%.',
    'Confidence: low to medium, because the rubric is still sparse.',
    "What's missing: most of the actual product surface area.",
    'What would have to be true for a higher estimate: multiple major surface families would need real parity proof.'
  ].join(' '));
  h.engine.runValidator(h.task().id, { source: 'manual-claim-integrity' });
  assert.equal(h.task().validation.passed, true);
  assert.equal(h.task().claimIntegrity.passed, true);
});

test('claim-integrity prompts auto-generate supervisor-backed artifacts and reject percentages that exceed the generated report', () => {
  const h = makeHarness({ config: { validationMode: 'important_only' } });
  const prompt = 'What percentage complete is the roadmap project right now?';
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-claim-auto'));
  h.engine.onBeforePromptBuild({ prompt }, ctx('sess-claim-auto'));
  const store = h.engine.loadStore();
  store.tasks.at(-1).contract.required = false;
  store.tasks.at(-1).campaign.required = false;
  store.tasks.at(-1).surfaceMatrix.required = false;
  store.tasks.at(-1).cloneParity.required = false;
  store.tasks.at(-1).honesty.required = false;
  store.tasks.at(-1).grounding.required = false;
  store.tasks.at(-1).grounding.replyThread.required = false;
  fs.writeFileSync(h.engine.paths.tasks, JSON.stringify(store, null, 2));

  const { matrixPath, programStatePath } = makeClaimIntegritySupervisorArtifacts(h.workspaceRoot);

  h.engine.completeInternally(h.task().id, `Estimated: 40% complete. Target path: ${h.workspaceRoot}. Fidelity: parity_for_scope. Scope: roadmap progress. Surface matrix: ${matrixPath}. Program state path: ${programStatePath}. Campaign mode: persistent. Supervisor status: red. Blocker: provider offline.`);
  h.engine.runValidator(h.task().id, { source: 'claim-auto-too-high' });

  assert.equal(h.task().claimIntegrity.autoGenerated, true);
  assert.ok(fs.existsSync(h.task().claimIntegrity.reportPath));
  assert.ok(fs.existsSync(h.task().claimIntegrity.responseFramePath));
  assert.ok(fs.existsSync(h.task().claimIntegrity.repoReportPath));
  assert.ok(fs.existsSync(h.task().claimIntegrity.repoResponseFramePath));
  assert.ok(fs.existsSync(h.task().claimIntegrity.repoSummaryPath));
  assert.equal(h.task().validation.passed, false);
  assert.equal(h.task().validation.failures.at(-1).reason, 'claim_integrity_progress_estimate_exceeds_generated_report');

  const generatedReport = JSON.parse(fs.readFileSync(h.task().claimIntegrity.reportPath, 'utf8'));
  assert.ok(generatedReport.progress.cloneParityPercent < 40);

  h.engine.completeInternally(h.task().id, `Estimated: 1% complete. Target path: ${h.workspaceRoot}. Fidelity: parity_for_scope. Scope: roadmap progress. Surface matrix: ${matrixPath}. Program state path: ${programStatePath}. Campaign mode: persistent. Supervisor status: red. Blocker: provider offline.`);
  h.engine.runValidator(h.task().id, { source: 'claim-auto-aligned' });

  assert.equal(h.task().validation.passed, true);
  assert.equal(h.task().claimIntegrity.passed, true);

  const frame = JSON.parse(fs.readFileSync(h.task().claimIntegrity.responseFramePath, 'utf8'));
  assert.equal(frame.estimated.proposedPercent, 1);

  const repoSummary = JSON.parse(fs.readFileSync(h.task().claimIntegrity.repoSummaryPath, 'utf8'));
  assert.equal(repoSummary.repoArtifactPaths.reportPath, h.task().claimIntegrity.repoReportPath);
});

test('completion messages cite repo-local claim-integrity artifact paths when they exist', async () => {
  const h = makeHarness({ config: { validationMode: 'important_only' } });
  const prompt = 'What percentage complete is the roadmap project right now?';
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-claim-delivery'));
  h.engine.onBeforePromptBuild({ prompt }, ctx('sess-claim-delivery'));
  const store = h.engine.loadStore();
  store.tasks.at(-1).contract.required = false;
  store.tasks.at(-1).campaign.required = false;
  store.tasks.at(-1).surfaceMatrix.required = false;
  store.tasks.at(-1).cloneParity.required = false;
  store.tasks.at(-1).honesty.required = false;
  store.tasks.at(-1).grounding.required = false;
  store.tasks.at(-1).grounding.replyThread.required = false;
  fs.writeFileSync(h.engine.paths.tasks, JSON.stringify(store, null, 2));

  const { matrixPath, programStatePath } = makeClaimIntegritySupervisorArtifacts(h.workspaceRoot);
  h.engine.completeInternally(h.task().id, `Estimated: 1% complete. Target path: ${h.workspaceRoot}. Fidelity: parity_for_scope. Scope: roadmap progress. Surface matrix: ${matrixPath}. Program state path: ${programStatePath}. Campaign mode: persistent. Supervisor status: red. Blocker: provider offline.`);
  h.engine.runValidator(h.task().id, { source: 'claim-delivery' });
  assert.equal(h.task().validation.passed, true);

  h.tick(1500);
  await h.engine.autoDeliverCompletedTasks({});
  const delivered = h.deliveries.at(-1).payloads[0].text;
  assert.match(delivered, /Claim integrity artifacts:/);
  assert.match(delivered, new RegExp(h.task().claimIntegrity.repoReportPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(delivered, new RegExp(h.task().claimIntegrity.repoResponseFramePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('campaign tasks inject task contract, campaign runtime, and surface matrix requirements', () => {
  const h = makeHarness({ config: { validationMode: 'important_only' } });
  const prompt = 'Continue the roadmap until complete. Do not stop for partial progress.';
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-campaign'));
  h.engine.onBeforePromptBuild({ prompt }, ctx('sess-campaign'));
  const injection = h.engine.buildPromptInjection('sess-campaign');
  assert.match(injection.appendSystemContext, /TASK_CONTRACT/);
  assert.match(injection.appendSystemContext, /CAMPAIGN_RUNTIME/);
  assert.match(injection.appendSystemContext, /SURFACE_MATRIX/);
  assert.equal(h.task().campaign.required, true);
  assert.equal(h.task().surfaceMatrix.required, true);
  assert.equal(h.task().contract.stopCondition, 'supervisor_green_or_blocker_report');
});

test('campaign tasks cannot stop while supervisor is red unless they include a blocker report', () => {
  const h = makeHarness({ config: { validationMode: 'important_only' } });
  const prompt = 'Finish the roadmap until complete with worker + supervisor + notifier';
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-red'));
  h.engine.onBeforePromptBuild({ prompt }, ctx('sess-red'));
  h.engine.onAgentEnd({ success: true, result: 'Anchor: roadmap. Target path: /root/clawd/project. Fidelity: parity_for_scope. Scope: roadmap execution. Stop condition: supervisor_green_or_blocker_report. Surface matrix: artifacts/matrix.json. Surface matrix status: partial. Campaign mode: persistent. Supervisor status: red. Diff scope: product files: app and tests.' }, ctx('sess-red'));
  assert.equal(h.task().validation.passed, false);
  assert.equal(h.task().validation.failures.at(-1).reason, 'campaign_stopped_while_supervisor_red');
});

test('campaign tasks may stop with a structured blocker report when supervisor stays red', async () => {
  const h = makeHarness({ config: { validationMode: 'important_only' } });
  const prompt = 'Finish the roadmap until complete with worker + supervisor + notifier';
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-blocker'));
  h.engine.onBeforePromptBuild({ prompt }, ctx('sess-blocker'));
  h.engine.onAgentEnd({ success: true, result: 'Anchor: roadmap. Target path: /root/clawd/project. Fidelity: parity_for_scope. Scope: roadmap execution. Stop condition: supervisor_green_or_blocker_report. Surface matrix: artifacts/matrix.json. Surface matrix status: blocked. Campaign mode: persistent. Supervisor status: red. Diff scope: product files: app and tests. Blocker: external provider sandbox unavailable. Next action: resume automatically once provider access is restored.' }, ctx('sess-blocker'));
  assert.equal(h.task().validation.passed, true);
  assert.equal(h.task().campaign.blockerPresent, true);
  assert.equal(h.task().surfaceMatrix.status, 'blocked');
  h.tick(1500);
  await h.engine.autoDeliverCompletedTasks({});
  assert.match(h.deliveries[0].payloads[0].text, /^Blocked:/);
});

test('recovers stale running tasks across restart and counts recovery success', () => {
  const h = makeHarness();
  h.engine.onBeforePromptBuild({ prompt: 'Fix the background subagent notifier' }, ctx('sess-r')); 
  const taskId = h.task().id;
  h.engine.startTask(taskId);
  h.tick(5000);
  const recovered = h.engine.recoverStaleTasks();
  assert.equal(recovered, 1);
  assert.equal(h.task().status, 'internal_complete');
  assert.equal(h.metrics().counters.recovery_success_count, 1);
});

test('dedupes repeated auto-delivery attempts and records duplicate reply metric', async () => {
  const h = makeHarness();
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-d'));
  h.engine.onBeforePromptBuild({ prompt: 'Implement async notification dedupe' }, ctx('sess-d'));
  h.engine.onAgentEnd({ success: true, result: 'Anchor: async notification dedupe task Target path: /root/clawd/plugins/completion-integrity Fidelity: production_slice Scope: async notification dedupe Stop condition: completed_and_delivered Diff scope: product files: core.mjs and tests; Async notification dedupe implemented' }, ctx('sess-d'));
  h.tick(1500);
  await h.engine.autoDeliverCompletedTasks({});
  assert.equal(h.deliveries.length, 1);
  await h.engine.autoDeliverCompletedTasks({});
  assert.equal(h.deliveries.length, 1);
  assert.ok(h.metrics().counters.duplicate_reply_count >= 0);
});

test('subagent completion flows to internal_complete and prompt injection appears until delivery confirmed', () => {
  const h = makeHarness();
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-s'));
  h.engine.onBeforePromptBuild({ prompt: 'Implement the trust-hardening system with subagent support' }, ctx('sess-s'));
  h.engine.onSubagentEnded({ result: 'Subagent finished trust-hardening system' }, ctx('sess-s'));
  assert.equal(h.task().status, 'internal_complete');
  const injection = h.engine.buildPromptInjection('sess-s');
  assert.match(injection.appendSystemContext, /must be clearly disclosed/);
});

test('runtime exec completed system messages promote active tasks to internal_complete', () => {
  const h = makeHarness();
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-x'));
  h.engine.onBeforePromptBuild({ prompt: 'Fix the gateway memory abort issue' }, ctx('sess-x'));
  assert.equal(h.task().status, 'running');
  h.engine.onBeforeMessageWrite({ message: { role: 'custom', content: 'System: [2026-03-19 22:50:15 CDT] Exec completed (delta-cr, code 0) :: bind=loopback ok' }, sessionKey: 'sess-x' }, ctx('sess-x'));
  assert.equal(h.task().status, 'internal_complete');
  assert.equal(h.task().completionSource, 'runtime_message');
});

test('runtime exec failed system messages fail active tasks', () => {
  const h = makeHarness();
  h.engine.onBeforePromptBuild({ prompt: 'Implement completion bridge for exec tasks' }, ctx('sess-f'));
  assert.equal(h.task().status, 'running');
  h.engine.onBeforeMessageWrite({ message: { role: 'custom', content: 'System: [2026-03-19 22:50:15 CDT] Exec failed (wild-wil, signal SIGKILL) :: process crashed' }, sessionKey: 'sess-f' }, ctx('sess-f'));
  assert.equal(h.task().status, 'failed');
  assert.equal(h.task().failureSource, 'runtime_message');
});

test('tool errors fail the task and increment tool error count', () => {
  const h = makeHarness();
  h.engine.onBeforePromptBuild({ prompt: 'Debug validator pipeline' }, ctx('sess-e'));
  h.engine.failTask(h.task().id, 'tool exploded', 'tool');
  assert.equal(h.task().status, 'failed');
  assert.equal(h.metrics().counters.tool_error_count, 1);
});

test('does not create completion-tracked tasks for conversational diagnostic questions', () => {
  const h = makeHarness();
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-q'));
  h.engine.onBeforePromptBuild({ prompt: 'Why were you just repeating messages?' }, ctx('sess-q'));
  assert.equal(h.engine.loadStore().tasks.length, 0);
});

test('tracks imperative do-it requests rather than misclassifying them as questions', () => {
  const h = makeHarness();
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-do'));
  h.engine.onBeforePromptBuild({ prompt: 'Do it — implement the previous roadmap carefully' }, ctx('sess-do'));
  assert.equal(h.task().status, 'running');
});

test('strips routing and envelope chatter before task detection', () => {
  const h = makeHarness();
  h.engine.onMessageReceived({ from: '+1', metadata: { messageId: 'm1' } }, ctx('sess-r2'));
  h.engine.onBeforePromptBuild({ prompt: 'Conversation info (untrusted metadata): ```json {"message_id":"1"} ```\nCortex upstream routing applied: L4, L15\nImplement the duplicate reply fix' }, ctx('sess-r2'));
  assert.equal(h.task().status, 'running');
  assert.equal(h.task().prompt, 'Implement the duplicate reply fix');
});
