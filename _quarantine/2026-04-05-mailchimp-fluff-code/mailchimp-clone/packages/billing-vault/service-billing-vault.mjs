import { createBillingVaultWorkspace, summarizeBillingVaultWorkspace, createBillingVaultNarratives, createBillingVaultCoverageGrid } from './domain-billing-vault.mjs';
import { createBillingVaultPolicies, validateBillingVaultPolicies, summarizeBillingVaultPolicies, createBillingVaultEscalationDeck } from './policies-billing-vault.mjs';
import { createBillingVaultAnalyticsTimeline, createBillingVaultForecastEnvelope, createBillingVaultExceptionLedger, summarizeBillingVaultAnalytics } from './analytics-billing-vault.mjs';
import { createBillingVaultOperationsBoard, createBillingVaultShiftChecklist, createBillingVaultIncidentDeck } from './operations-billing-vault.mjs';
import { createBillingVaultReportCards, createBillingVaultReviewPackets, summarizeBillingVaultReporting } from './reporting-billing-vault.mjs';
import { createBillingVaultAuditTrail, createBillingVaultEvidenceManifest, createBillingVaultReadinessAttestation } from './audit-billing-vault.mjs';
import { createBillingVaultPlaybooks, createBillingVaultDecisionDeck, createBillingVaultEscalationMoments } from './playbooks-billing-vault.mjs';

export function buildBillingVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createBillingVaultWorkspace(workspaceName);
  const policies = createBillingVaultPolicies();
  return {
    workspace,
    summary: summarizeBillingVaultWorkspace(workspace),
    narratives: createBillingVaultNarratives(workspace),
    coverage: createBillingVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeBillingVaultPolicies(policies),
    validation: validateBillingVaultPolicies(policies),
    escalationDeck: createBillingVaultEscalationDeck(policies),
    analytics: {
      timeline: createBillingVaultAnalyticsTimeline(),
      forecast: createBillingVaultForecastEnvelope(),
      exceptions: createBillingVaultExceptionLedger(),
      summary: summarizeBillingVaultAnalytics()
    },
    operations: {
      board: createBillingVaultOperationsBoard(),
      checklist: createBillingVaultShiftChecklist(),
      incidents: createBillingVaultIncidentDeck()
    },
    reporting: {
      cards: createBillingVaultReportCards(),
      packets: createBillingVaultReviewPackets(),
      summary: summarizeBillingVaultReporting()
    },
    audit: {
      trail: createBillingVaultAuditTrail(),
      manifest: createBillingVaultEvidenceManifest(),
      attestation: createBillingVaultReadinessAttestation()
    },
    playbooks: createBillingVaultPlaybooks(),
    decisions: createBillingVaultDecisionDeck(),
    escalationMoments: createBillingVaultEscalationMoments()
  };
}

export function createBillingVaultReadinessBoard(snapshot = buildBillingVaultSnapshot()) {
  return [
    { id: 'billing-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'billing-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'billing-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'billing-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createBillingVaultApiDocument(snapshot = buildBillingVaultSnapshot()) {
  return {
    id: 'billing-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/billing-vault/overview' },
      { method: 'GET', path: '/api/billing-vault/reporting' },
      { method: 'POST', path: '/api/billing-vault/validate' },
      { method: 'GET', path: '/api/billing-vault/audit' }
    ],
    readiness: createBillingVaultReadinessBoard(snapshot)
  };
}

export function createBillingVaultRouteSummary(snapshot = buildBillingVaultSnapshot()) {
  return {
    id: snapshot.workspace.id,
    title: snapshot.summary.title,
    focus: snapshot.workspace.focus,
    groupTitle: snapshot.summary.groupTitle,
    metricCount: snapshot.summary.metricCount,
    policyCount: snapshot.policySummary.total,
    executiveCards: snapshot.reporting.summary.executiveCards
  };
}

