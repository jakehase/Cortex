import { createCommerceVaultWorkspace, summarizeCommerceVaultWorkspace, createCommerceVaultNarratives, createCommerceVaultCoverageGrid } from './domain-commerce-vault.mjs';
import { createCommerceVaultPolicies, validateCommerceVaultPolicies, summarizeCommerceVaultPolicies, createCommerceVaultEscalationDeck } from './policies-commerce-vault.mjs';
import { createCommerceVaultAnalyticsTimeline, createCommerceVaultForecastEnvelope, createCommerceVaultExceptionLedger, summarizeCommerceVaultAnalytics } from './analytics-commerce-vault.mjs';
import { createCommerceVaultOperationsBoard, createCommerceVaultShiftChecklist, createCommerceVaultIncidentDeck } from './operations-commerce-vault.mjs';
import { createCommerceVaultReportCards, createCommerceVaultReviewPackets, summarizeCommerceVaultReporting } from './reporting-commerce-vault.mjs';
import { createCommerceVaultAuditTrail, createCommerceVaultEvidenceManifest, createCommerceVaultReadinessAttestation } from './audit-commerce-vault.mjs';
import { createCommerceVaultPlaybooks, createCommerceVaultDecisionDeck, createCommerceVaultEscalationMoments } from './playbooks-commerce-vault.mjs';

export function buildCommerceVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCommerceVaultWorkspace(workspaceName);
  const policies = createCommerceVaultPolicies();
  return {
    workspace,
    summary: summarizeCommerceVaultWorkspace(workspace),
    narratives: createCommerceVaultNarratives(workspace),
    coverage: createCommerceVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeCommerceVaultPolicies(policies),
    validation: validateCommerceVaultPolicies(policies),
    escalationDeck: createCommerceVaultEscalationDeck(policies),
    analytics: {
      timeline: createCommerceVaultAnalyticsTimeline(),
      forecast: createCommerceVaultForecastEnvelope(),
      exceptions: createCommerceVaultExceptionLedger(),
      summary: summarizeCommerceVaultAnalytics()
    },
    operations: {
      board: createCommerceVaultOperationsBoard(),
      checklist: createCommerceVaultShiftChecklist(),
      incidents: createCommerceVaultIncidentDeck()
    },
    reporting: {
      cards: createCommerceVaultReportCards(),
      packets: createCommerceVaultReviewPackets(),
      summary: summarizeCommerceVaultReporting()
    },
    audit: {
      trail: createCommerceVaultAuditTrail(),
      manifest: createCommerceVaultEvidenceManifest(),
      attestation: createCommerceVaultReadinessAttestation()
    },
    playbooks: createCommerceVaultPlaybooks(),
    decisions: createCommerceVaultDecisionDeck(),
    escalationMoments: createCommerceVaultEscalationMoments()
  };
}

export function createCommerceVaultReadinessBoard(snapshot = buildCommerceVaultSnapshot()) {
  return [
    { id: 'commerce-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'commerce-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'commerce-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'commerce-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCommerceVaultApiDocument(snapshot = buildCommerceVaultSnapshot()) {
  return {
    id: 'commerce-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/commerce-vault/overview' },
      { method: 'GET', path: '/api/commerce-vault/reporting' },
      { method: 'POST', path: '/api/commerce-vault/validate' },
      { method: 'GET', path: '/api/commerce-vault/audit' }
    ],
    readiness: createCommerceVaultReadinessBoard(snapshot)
  };
}

export function createCommerceVaultRouteSummary(snapshot = buildCommerceVaultSnapshot()) {
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

