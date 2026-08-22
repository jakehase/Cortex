#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildMailchimpFrontierQueueCatalog } from './mailchimp-continuous-frontier-catalog.mjs';
import { buildMailchimpGlobalGapQueueCatalog } from './mailchimp-global-gap-inventory-catalog.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STACK_ROOT = path.resolve(path.join(SCRIPT_DIR, '../..'));
const DEFAULT_MAILCHIMP_ROOT = path.resolve(path.join(DEFAULT_STACK_ROOT, '..', 'mailchimp-clone'));
const DEFAULT_RUNNER_SCRIPT = path.join(SCRIPT_DIR, 'run-mailchimp-autonomous-continuation.mjs');

export const CONTINUOUS_NEGATIVE_SPACE_CATALOG = [
  {
    id: 'sms_marketing_native_runtime_layer',
    label: 'SMS marketing native consent, compliance, delivery, click tracking, and runtime API evidence',
    strictGap: 'sms marketing parity: omnichannel programs exist, but Mailchimp-grade SMS consent receipts, quiet-hour compliance, carrier delivery attempts, link tracking, and runtime API evidence remain open',
    sourceLabels: ['SMS marketing', 'omnichannel messaging', 'preference consent'],
    afterSurfaceIds: ['content_studio_template_asset_runtime_layer'],
    afterStrictGaps: ['content studio/template library parity: assets and templates exist, but Mailchimp-grade asset lifecycle approvals, brand governance, review lineage, usage telemetry, and runtime API evidence remain open'],
    productGoal: 'Close or honestly block native SMS marketing runtime parity with consent receipts, compliance checks, carrier delivery attempts, click/link telemetry, snapshots, and an authenticated runtime API.',
    suggestedProductFiles: ['packages/app/domain-current-product-ops.mjs', 'packages/app/routes/current-product-ops.mjs', 'packages/app/storage.mjs'],
    targetedTests: ['tests/sms-marketing-runtime.test.mjs', 'tests/current-product-parity.test.mjs', 'tests/sms-orchestration.test.mjs']
  },
  {
    id: 'social_publishing_native_runtime_layer',
    label: 'Social post publishing approval, scheduling, provider handoff, and analytics runtime evidence',
    strictGap: 'social publishing parity: social workstreams exist, but Mailchimp-grade post scheduling, approval, provider handoff, engagement telemetry, and runtime API evidence remain open',
    sourceLabels: ['Social Posts', 'Social media marketing'],
    afterSurfaceIds: ['sms_marketing_native_runtime_layer'],
    afterStrictGaps: ['sms marketing parity: omnichannel programs exist, but Mailchimp-grade SMS consent receipts, quiet-hour compliance, carrier delivery attempts, link tracking, and runtime API evidence remain open'],
    productGoal: 'Close or honestly block native social publishing runtime parity with approvals, provider handoff, scheduled post ledger, engagement telemetry, snapshots, and API evidence.',
    suggestedProductFiles: ['packages/app/domain-current-product-ops.mjs', 'packages/app/routes/current-product-ops.mjs', 'packages/app/storage.mjs'],
    targetedTests: ['tests/social-publisher.test.mjs', 'tests/current-product-parity.test.mjs']
  },
  {
    id: 'ads_retargeting_runtime_layer',
    label: 'Digital ads retargeting audience, budget, provider sync, conversion, and runtime API evidence',
    strictGap: 'digital ads parity: ad channel programs exist, but Mailchimp-grade retargeting audiences, budget pacing, provider sync, conversion attribution, and runtime API evidence remain open',
    sourceLabels: ['Digital ads', 'Retargeting Ads'],
    afterSurfaceIds: ['social_publishing_native_runtime_layer'],
    afterStrictGaps: ['social publishing parity: social workstreams exist, but Mailchimp-grade post scheduling, approval, provider handoff, engagement telemetry, and runtime API evidence remain open'],
    productGoal: 'Close or honestly block native digital-ads runtime parity with retargeting audiences, budget pacing, provider sync, conversion attribution, snapshots, and API evidence.',
    suggestedProductFiles: ['packages/app/domain-current-product-ops.mjs', 'packages/app/routes/current-product-ops.mjs', 'packages/app/storage.mjs'],
    targetedTests: ['tests/current-product-parity.test.mjs']
  },
  {
    id: 'developer_webhooks_api_runtime_layer',
    label: 'Developer API/webhook runtime with event subscriptions, replay, signing, API key scopes, and runtime evidence',
    strictGap: 'developer webhooks/API parity: API keys and webhooks exist, but Mailchimp-grade scoped keys, subscription lifecycle, signed delivery replay, request audit, and runtime API evidence remain open',
    sourceLabels: ['Webhooks', 'Developer tools', 'API docs'],
    afterSurfaceIds: ['ads_retargeting_runtime_layer'],
    afterStrictGaps: ['digital ads parity: ad channel programs exist, but Mailchimp-grade retargeting audiences, budget pacing, provider sync, conversion attribution, and runtime API evidence remain open'],
    productGoal: 'Close or honestly block developer API/webhook runtime parity with scoped keys, subscriptions, signed replay, request audits, snapshots, and API evidence.',
    suggestedProductFiles: ['packages/app/routes/api-admin.mjs', 'packages/app/domain-core.mjs', 'packages/app/storage.mjs'],
    targetedTests: ['tests/developer-api-webhook-runtime.test.mjs', 'tests/platform-spine.test.mjs', 'tests/reports-admin.test.mjs']
  },
  {
    id: 'billing_entitlements_usage_runtime_layer',
    label: 'Billing entitlement reconciliation, usage meter, trial, invoice/tax collection, and runtime API evidence',
    strictGap: 'billing/entitlements parity: plan pages exist, but Mailchimp-grade entitlement reconciliation, usage meters, trials, invoice/tax collection runs, and runtime API evidence remain open',
    sourceLabels: ['Billing and plans', 'Billing/entitlements platform', 'Usage meters'],
    afterSurfaceIds: ['developer_webhooks_api_runtime_layer'],
    afterStrictGaps: ['developer webhooks/API parity: API keys and webhooks exist, but Mailchimp-grade scoped keys, subscription lifecycle, signed delivery replay, request audit, and runtime API evidence remain open'],
    productGoal: 'Close or honestly block billing entitlement runtime parity with plan reconciliation, usage meters, trials, invoice/tax collection events, snapshots, and API evidence.',
    suggestedProductFiles: ['packages/app/domain-core.mjs', 'packages/app/routes/platform.mjs', 'packages/app/routes/api-admin.mjs', 'packages/app/storage.mjs'],
    targetedTests: ['tests/billing-entitlements-runtime.test.mjs', 'tests/platform-spine.test.mjs', 'tests/reports-admin.test.mjs']
  },
  {
    id: 'team_governance_permissions_runtime_layer',
    label: 'Team governance permission policy, delegated admin, SCIM provisioning, access review, region governance, and runtime API evidence',
    strictGap: 'team roles/permissions parity: invitations and role updates exist, but Mailchimp-grade permission policy, delegated administration, SCIM provisioning, access review, region governance, and runtime API evidence remain open',
    sourceLabels: ['Team users, roles, and permissions', 'Enterprise identity and governance', 'SCIM and delegated administration'],
    afterSurfaceIds: ['billing_entitlements_usage_runtime_layer'],
    afterStrictGaps: ['billing/entitlements parity: plan pages exist, but Mailchimp-grade entitlement reconciliation, usage meters, trials, invoice/tax collection runs, and runtime API evidence remain open'],
    productGoal: 'Close or honestly block team governance parity with permission policy matrix, delegated administration, SCIM provisioning events, access reviews, region governance, snapshots, and API evidence.',
    suggestedProductFiles: ['packages/app/domain-core.mjs', 'packages/app/routes/platform.mjs', 'packages/app/routes/api-admin.mjs', 'packages/app/storage.mjs'],
    targetedTests: ['tests/team-governance-runtime.test.mjs', 'tests/platform-spine.test.mjs', 'tests/billing-entitlements-runtime.test.mjs', 'tests/developer-api-webhook-runtime.test.mjs']
  },
  {
    id: 'settings_domains_deliverability_runtime_layer',
    label: 'Settings domains DNS authentication, DMARC alignment, sender warmup, dedicated IP readiness, compliance review, and runtime API evidence',
    strictGap: 'settings/domains parity: domain verification exists, but Mailchimp-grade DNS checks, DMARC alignment, sender reputation warmup, dedicated IP readiness, compliance review, and runtime API evidence remain open',
    sourceLabels: ['Settings, domains, and authentication', 'Deliverability and sending infrastructure', 'Domain authentication'],
    afterSurfaceIds: ['team_governance_permissions_runtime_layer'],
    afterStrictGaps: ['team roles/permissions parity: invitations and role updates exist, but Mailchimp-grade permission policy, delegated administration, SCIM provisioning, access review, region governance, and runtime API evidence remain open'],
    productGoal: 'Close or honestly block settings/domains deliverability parity with DNS auth checks, DMARC alignment, sender warmup, dedicated IP readiness, compliance review, snapshots, and API evidence.',
    suggestedProductFiles: ['packages/app/domain-deliverability-compliance.mjs', 'packages/app/routes/deliverability-compliance.mjs', 'packages/app/routes/api-admin.mjs', 'packages/app/storage.mjs'],
    targetedTests: ['tests/settings-domains-deliverability-runtime.test.mjs', 'tests/deliverability-compliance.test.mjs', 'tests/platform-spine.test.mjs', 'tests/team-governance-runtime.test.mjs']
  },
  {
    id: 'dashboard_home_insights_runtime_layer',
    label: 'Dashboard home role-aware widgets, saved views, insight task queues, data freshness, drillthrough telemetry, and runtime API evidence',
    strictGap: 'dashboard/home parity: summary cards exist, but Mailchimp-grade role-aware widgets, saved views, insight task queues, data freshness drilldowns, drillthrough telemetry, and runtime API evidence remain open',
    sourceLabels: ['Dashboard / home', 'Role-aware task queues', 'Data freshness and insight prioritization'],
    afterSurfaceIds: ['settings_domains_deliverability_runtime_layer'],
    afterStrictGaps: ['settings/domains parity: domain verification exists, but Mailchimp-grade DNS checks, DMARC alignment, sender reputation warmup, dedicated IP readiness, compliance review, and runtime API evidence remain open'],
    productGoal: 'Close or honestly block dashboard/home runtime parity with role-aware widgets, saved views, insight task queues, data freshness, drillthrough telemetry, snapshots, and API evidence.',
    suggestedProductFiles: ['packages/app/domain-core.mjs', 'packages/app/routes/platform.mjs', 'packages/app/routes/api-admin.mjs', 'packages/app/storage.mjs'],
    targetedTests: ['tests/dashboard-home-runtime.test.mjs', 'tests/platform-spine.test.mjs', 'tests/settings-domains-deliverability-runtime.test.mjs', 'tests/team-governance-runtime.test.mjs']
  },
  {
    id: 'campaign_experimentation_decision_runtime_layer',
    label: 'Campaign experimentation variant allocation, dynamic content, holdout compliance, winner decision audit, and runtime API evidence',
    strictGap: 'campaign experimentation parity: basic A/B campaign flows exist, but Mailchimp-grade variant allocation, dynamic content resolution, holdout compliance, winner decision audit, runtime snapshots, and API evidence remain open',
    sourceLabels: ['Experimentation / A-B / dynamic content depth', 'Campaign creation, email builder, send flows', 'Reporting, analytics, dashboards'],
    afterSurfaceIds: ['dashboard_home_insights_runtime_layer'],
    afterStrictGaps: ['dashboard/home parity: summary cards exist, but Mailchimp-grade role-aware widgets, saved views, insight task queues, data freshness drilldowns, drillthrough telemetry, and runtime API evidence remain open'],
    productGoal: 'Close or honestly block campaign experimentation runtime parity with variant allocation, dynamic content resolution, holdout compliance, winner decision audit, snapshots, and API evidence.',
    suggestedProductFiles: ['packages/app/domain-current-product-ops.mjs', 'packages/app/routes/current-product-ops.mjs', 'packages/app/storage.mjs'],
    targetedTests: ['tests/campaign-experiment-runtime.test.mjs', 'tests/current-product-parity.test.mjs', 'tests/dashboard-home-runtime.test.mjs', 'tests/platform-spine.test.mjs']
  },
  {
    id: 'postcard_direct_mail_runtime_layer',
    label: 'Postcard/direct-mail audience eligibility, creative proof, print handoff, delivery tracking, and runtime API evidence',
    strictGap: 'postcard/direct-mail parity: omnichannel programs mention postcards, but Mailchimp-grade postal audience eligibility, creative proof approval, print vendor handoff, delivery tracking, runtime snapshots, and API evidence remain open',
    sourceLabels: ['Omnichannel marketing surfaces beyond email', 'SMS/social/postcards channel-specific UX', 'Gap 5 — Ads / Social / Omnichannel Depth'],
    afterSurfaceIds: ['campaign_experimentation_decision_runtime_layer'],
    afterStrictGaps: ['campaign experimentation parity: basic A/B campaign flows exist, but Mailchimp-grade variant allocation, dynamic content resolution, holdout compliance, winner decision audit, runtime snapshots, and API evidence remain open'],
    productGoal: 'Close or honestly block postcard/direct-mail runtime parity with postal audience eligibility, address validation, creative proof approval, print vendor handoff, delivery tracking, snapshots, and authenticated API evidence.',
    suggestedProductFiles: ['packages/app/domain-current-product-ops.mjs', 'packages/app/routes/current-product-ops.mjs', 'packages/app/storage.mjs'],
    targetedTests: ['tests/postcard-direct-mail-runtime.test.mjs', 'tests/current-product-parity.test.mjs', 'tests/campaign-experiment-runtime.test.mjs']
  },
  {
    id: 'cross_channel_journey_runtime_layer',
    label: 'Cross-channel journey builder nodes, channel handoffs, decisions, performance rollups, snapshots, and runtime API evidence',
    strictGap: 'cross-channel journey parity: automation nodes exist, but Mailchimp-grade email/SMS/ad/inbox/survey/postcard journey nodes, channel handoffs, decision audit, performance rollups, runtime snapshots, and API evidence remain open',
    sourceLabels: ['Gap 5.4 Cross-channel journey builder', 'Ads / Social / Omnichannel Depth', 'Omnichannel marketing surfaces beyond email'],
    afterSurfaceIds: ['postcard_direct_mail_runtime_layer'],
    afterStrictGaps: ['postcard/direct-mail parity: omnichannel programs mention postcards, but Mailchimp-grade postal audience eligibility, creative proof approval, print vendor handoff, delivery tracking, runtime snapshots, and API evidence remain open'],
    productGoal: 'Close or honestly block cross-channel journey runtime parity with email/SMS/ad-sync/inbox/survey/postcard nodes, channel handoff history, decision audit, channel performance rollups, snapshots, and authenticated API evidence.',
    suggestedProductFiles: ['packages/app/domain-growth.mjs', 'packages/app/domain-journeys.mjs', 'packages/app/routes/automations.mjs', 'packages/app/storage.mjs'],
    targetedTests: ['tests/cross-channel-journey-runtime.test.mjs', 'tests/automation-journeys.test.mjs', 'tests/current-product-parity.test.mjs']
  },
  {
    id: 'social_calendar_coordination_runtime_layer',
    label: 'Social calendar campaign-linked placements, cross-channel timeline, snapshots, and runtime API evidence',
    strictGap: 'social calendar coordination parity: social publishing exists, but Mailchimp-grade campaign-linked social calendar placements, cross-channel timeline events, coordination ledgers, runtime snapshots, and API evidence remain open',
    sourceLabels: ['Social calendar', 'Social media marketing', 'Cross-channel campaign coordination'],
    afterSurfaceIds: ['cross_channel_journey_runtime_layer'],
    afterStrictGaps: ['cross-channel journey parity: automation nodes exist, but Mailchimp-grade email/SMS/ad/inbox/survey/postcard journey nodes, channel handoffs, decision audit, performance rollups, runtime snapshots, and API evidence remain open'],
    productGoal: 'Close or honestly block social calendar coordination parity with campaign-linked placements, coordination events, timeline events, snapshots, and authenticated API evidence.',
    suggestedProductFiles: ['packages/app/domain-current-product-ops.mjs', 'packages/app/routes/current-product-ops.mjs', 'packages/app/storage.mjs'],
    targetedTests: ['tests/social-calendar-coordination-runtime.test.mjs', 'tests/social-publishing-runtime.test.mjs', 'tests/current-product-parity.test.mjs']
  },
  {
    id: 'omnichannel_reporting_attribution_runtime_layer',
    label: 'Omnichannel reporting channel mix, objective rollups, touchpoint attribution, snapshots, and runtime API evidence',
    strictGap: 'omnichannel reporting attribution parity: channel programs exist, but Mailchimp-grade channel mix dashboards, objective rollups, touchpoint attribution events, durable reporting snapshots, and API evidence remain open',
    sourceLabels: ['Reporting, analytics, dashboards', 'Omnichannel marketing surfaces beyond email', 'Attribution'],
    afterSurfaceIds: ['social_calendar_coordination_runtime_layer'],
    afterStrictGaps: ['social calendar coordination parity: social publishing exists, but Mailchimp-grade campaign-linked social calendar placements, cross-channel timeline events, coordination ledgers, runtime snapshots, and API evidence remain open'],
    productGoal: 'Close or honestly block omnichannel reporting attribution parity with channel mix snapshots, objective rollups, touchpoint attribution events, reporting snapshots, and authenticated API evidence.',
    suggestedProductFiles: ['packages/app/domain-current-product-ops.mjs', 'packages/app/routes/current-product-ops.mjs', 'packages/app/storage.mjs'],
    targetedTests: ['tests/omnichannel-reporting-attribution-runtime.test.mjs', 'tests/social-calendar-coordination-runtime.test.mjs', 'tests/postcard-direct-mail-runtime.test.mjs', 'tests/current-product-parity.test.mjs']
  }
];

CONTINUOUS_NEGATIVE_SPACE_CATALOG.push(...buildMailchimpFrontierQueueCatalog());

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-').replace('Z', '');
}

function parseArgs(argv) {
  const args = {
    stackRoot: DEFAULT_STACK_ROOT,
    mailchimpRoot: DEFAULT_MAILCHIMP_ROOT,
    runnerScript: DEFAULT_RUNNER_SCRIPT,
    anchorArtifactRoot: null,
    artifactRoot: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--stack-root') { args.stackRoot = path.resolve(next); index += 1; continue; }
    if (token === '--mailchimp-root') { args.mailchimpRoot = path.resolve(next); index += 1; continue; }
    if (token === '--runner-script') { args.runnerScript = path.resolve(next); index += 1; continue; }
    if (token === '--anchor-artifact-root' || token === '--seed-artifact-root') { args.anchorArtifactRoot = path.resolve(next); index += 1; continue; }
    if (token === '--artifact-root') { args.artifactRoot = path.resolve(next); index += 1; continue; }
  }
  if (!args.anchorArtifactRoot) throw new Error('Missing --anchor-artifact-root');
  if (!args.artifactRoot) args.artifactRoot = path.join(args.stackRoot, 'artifacts/benchmarks/mailchimp_continuous_queue_expander', `expand-${stamp()}`);
  return args;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function loadSupportedCatalog(args) {
  const result = spawnSync(process.execPath, [args.runnerScript, '--list-supported-gaps-json', '--stack-root', args.stackRoot, '--mailchimp-root', args.mailchimpRoot], {
    cwd: args.stackRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    return { ok: false, error: result.stderr || result.stdout || `exit ${result.status}`, supportedSurfaces: [], supportedStrictGaps: new Set() };
  }
  const payload = JSON.parse(result.stdout || '{}');
  const supportedSurfaces = Array.isArray(payload.supportedSurfaces) ? payload.supportedSurfaces : [];
  return { ok: true, supportedSurfaces, supportedStrictGaps: new Set(supportedSurfaces.map((entry) => entry.strictGap).filter(Boolean)) };
}

function findStrictInventoryPath(mailchimpRoot) {
  const candidates = [
    path.join(mailchimpRoot, 'artifacts/full_audit_campaign/strict_1to1_gap_inventory.json'),
    path.join(mailchimpRoot, 'docs/MAILCHIMP_STRICT_1TO1_GAP_INVENTORY_2026-05-08.json')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function loadStrictInventory(mailchimpRoot) {
  const inventoryPath = findStrictInventoryPath(mailchimpRoot);
  const inventory = inventoryPath ? readJson(inventoryPath, {}) : {};
  const gaps = Array.isArray(inventory.gaps) ? inventory.gaps : [];
  const remainingGaps = gaps.filter((gap) => String(gap.status || 'remaining_gap') === 'remaining_gap');
  return {
    inventoryPath,
    gapCount: Number(inventory.gapCount ?? gaps.length),
    remainingGapCount: remainingGaps.length,
    remainingGapIds: new Set(remainingGaps.map((gap) => gap.id).filter(Boolean)),
    remainingGapsById: new Map(remainingGaps.map((gap) => [gap.id, gap]))
  };
}

function buildInventoryBackedCatalog(strictInventory) {
  if (!strictInventory.remainingGapCount) return [];
  return buildMailchimpGlobalGapQueueCatalog()
    .filter((candidate) => strictInventory.remainingGapIds.has(candidate.globalGapId))
    .map((candidate) => {
      const inventoryGap = strictInventory.remainingGapsById.get(candidate.globalGapId) || {};
      return {
        ...candidate,
        catalogSource: 'strict_1to1_gap_inventory',
        strictInventoryPath: strictInventory.inventoryPath,
        strictInventoryStatus: inventoryGap.status || 'remaining_gap',
        strictInventoryLabel: inventoryGap.label || candidate.globalGapLabel,
        strictInventoryGapId: candidate.globalGapId
      };
    });
}

function selectedHistory(anchorSummary = {}) {
  return [
    anchorSummary.selectedSurfaceId,
    anchorSummary.selectedStrictGap,
    ...(Array.isArray(anchorSummary.iterations) ? anchorSummary.iterations.flatMap((entry) => [entry.selectedSurfaceId, entry.selectedStrictGap]) : [])
  ].filter(Boolean);
}

function chooseCandidate(anchorSummary, matrix) {
  const history = selectedHistory(anchorSummary);
  const historySet = new Set(history);
  const lastSelected = history.at(-2) && String(history.at(-2)).includes('_layer') ? history.at(-2) : anchorSummary.selectedSurfaceId || null;
  const lastGap = anchorSummary.selectedStrictGap || history.findLast?.((entry) => String(entry).includes(' parity:')) || null;
  const direct = matrix.find((candidate) => !historySet.has(candidate.id) && !historySet.has(candidate.strictGap) && (candidate.afterSurfaceIds.includes(lastSelected) || candidate.afterStrictGaps.includes(lastGap)));
  if (direct) return direct;
  const firstUnvisitedInventoryCandidate = matrix.find((candidate) => candidate.catalogSource === 'strict_1to1_gap_inventory' && !historySet.has(candidate.id) && !historySet.has(candidate.strictGap));
  if (firstUnvisitedInventoryCandidate) return firstUnvisitedInventoryCandidate;
  return null;
}

const args = parseArgs(process.argv.slice(2));
fs.mkdirSync(args.artifactRoot, { recursive: true });
const generatedAt = new Date().toISOString();
const anchorSummary = readJson(path.join(args.anchorArtifactRoot, 'completion_summary.json'), {}) || {};
const supportedCatalog = loadSupportedCatalog(args);
const strictInventory = loadStrictInventory(args.mailchimpRoot);
const inventoryBackedCatalog = buildInventoryBackedCatalog(strictInventory);
const candidateCatalog = inventoryBackedCatalog.length ? inventoryBackedCatalog : CONTINUOUS_NEGATIVE_SPACE_CATALOG;
const matrix = candidateCatalog.map((candidate, index) => ({
  ...candidate,
  ordinal: index + 1,
  supportedByContinuationRunner: supportedCatalog.supportedStrictGaps.has(candidate.strictGap),
  status: supportedCatalog.supportedStrictGaps.has(candidate.strictGap) ? 'registered_supported_surface_ready_for_autopilot' : 'needs_continuation_surface_handler'
}));
const selected = chooseCandidate(anchorSummary, matrix);
const work = selected ? [{
  id: `${selected.id}__continuous_negative_space`,
  parentSurfaceId: selected.id,
  strictGap: selected.strictGap,
  productGoal: selected.productGoal,
  sourceLabels: selected.sourceLabels,
  allowedFiles: selected.suggestedProductFiles,
  targetedTests: selected.targetedTests,
  globalGapId: selected.globalGapId || null,
  globalGapLabel: selected.globalGapLabel || null,
  catalogSource: selected.catalogSource || 'continuous_negative_space_catalog',
  creditRequirement: selected.creditRequirement || 'product_diff_or_supported_runtime_proof',
  supportedByContinuationRunner: selected.supportedByContinuationRunner,
  stopCondition: 'supervisor_green_or_blocker_report'
}] : [];
const completion = {
  generatedAt,
  benchmarkId: 'mailchimp_continuous_queue_expander',
  runId: `mailchimp_continuous_queue_expander-${path.basename(args.artifactRoot)}`,
  artifactRoot: args.artifactRoot,
  targetPath: args.mailchimpRoot,
  anchorArtifactRoot: args.anchorArtifactRoot,
  fidelity: 'production_slice_control_plane',
  implementationSurface: 'control_plane_negative_space_queue_expander',
  thresholdPass: work.length > 0,
  supervisorStatus: work.length > 0 ? 'green_for_queue_expansion_scope' : 'blocked',
  globalFullClonePass: false,
  strictInventoryPath: strictInventory.inventoryPath,
  strictInventoryRemainingGapCount: strictInventory.remainingGapCount,
  candidateCatalogSource: inventoryBackedCatalog.length ? 'strict_1to1_gap_inventory' : 'continuous_negative_space_catalog',
  selectedStrictGap: selected?.strictGap || null,
  selectedSurfaceId: selected?.id || null,
  selectedGlobalGapId: selected?.globalGapId || null,
  selectedGlobalGapLabel: selected?.globalGapLabel || null,
  selectedSupportedByContinuationRunner: selected?.supportedByContinuationRunner || false,
  nextWorkQueueCount: work.length,
  blocker: work.length ? null : {
    blockerKind: 'continuous_queue_expander_no_candidate',
    message: 'No next negative-space candidate could be selected from the expansion matrix, but global full-clone completion was not proven.',
    nextAction: strictInventory.remainingGapCount
      ? 'Add strict_1to1_gap_inventory mappings or continuation handlers for the remaining global gap IDs, then relaunch a small smoke.'
      : 'Extend CONTINUOUS_NEGATIVE_SPACE_CATALOG from official Mailchimp surface inventory, then relaunch autopilot.'
  },
  truthBoundary: 'This is a control-plane queue expansion artifact. It selects the next grounded negative-space product surface for the continuation runner; it is not product implementation and not a Mailchimp full-clone completion claim.'
};
writeJson(path.join(args.artifactRoot, 'run_contract.json'), {
  generatedAt,
  fidelity: completion.fidelity,
  scope: 'expand_exhausted_mailchimp_autonomous_queue_from_negative_space_matrix',
  targetPath: args.mailchimpRoot,
  anchorArtifactRoot: args.anchorArtifactRoot,
  stopCondition: 'write_next_work_queue_or_blocker_report'
});
writeJson(path.join(args.artifactRoot, 'strict_1to1_gap_inventory_audit.json'), { generatedAt, inventoryPath: strictInventory.inventoryPath, gapCount: strictInventory.gapCount, remainingGapCount: strictInventory.remainingGapCount, mappedRemainingGapCount: inventoryBackedCatalog.length, candidateCatalogSource: completion.candidateCatalogSource });
writeJson(path.join(args.artifactRoot, 'continuous_negative_space_matrix.json'), { generatedAt, anchorArtifactRoot: args.anchorArtifactRoot, supportedCatalogOk: supportedCatalog.ok, supportedSurfaceCount: supportedCatalog.supportedSurfaces.length, strictInventoryPath: strictInventory.inventoryPath, strictInventoryRemainingGapCount: strictInventory.remainingGapCount, candidateCatalogSource: completion.candidateCatalogSource, candidates: matrix });
writeJson(path.join(args.artifactRoot, 'next_work_queue.json'), { generatedAt, count: work.length, work });
writeJson(path.join(args.artifactRoot, 'completion_summary.json'), completion);
writeJson(path.join(args.artifactRoot, 'threshold_evaluation.json'), {
  generatedAt,
  thresholdPass: completion.thresholdPass,
  ok: completion.thresholdPass,
  benchmarkTier: 'mailchimp_continuous_queue_expansion_control_plane',
  failures: completion.thresholdPass ? [] : [{ metric: 'nextWorkQueueCount', actual: 0, requirement: '> 0', reason: completion.blocker.message }],
  metrics: { candidateCount: matrix.length, nextWorkQueueCount: work.length, selectedSupportedByContinuationRunner: completion.selectedSupportedByContinuationRunner, strictInventoryRemainingGapCount: strictInventory.remainingGapCount }
});
if (completion.blocker) writeJson(path.join(args.artifactRoot, 'blocker_report.json'), { generatedAt, status: 'blocked', ...completion.blocker });
console.log(JSON.stringify({ ok: completion.thresholdPass, thresholdPass: completion.thresholdPass, artifactRoot: args.artifactRoot, selectedStrictGap: completion.selectedStrictGap, selectedSupportedByContinuationRunner: completion.selectedSupportedByContinuationRunner, blocker: completion.blocker }, null, 2));
process.exit(completion.thresholdPass ? 0 : 1);
