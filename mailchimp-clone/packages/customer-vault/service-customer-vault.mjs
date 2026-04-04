import { createCustomerVaultWorkspace, summarizeCustomerVaultWorkspace, createCustomerVaultNarratives, createCustomerVaultCoverageGrid } from './domain-customer-vault.mjs';
import { createCustomerVaultPolicies, validateCustomerVaultPolicies, summarizeCustomerVaultPolicies, createCustomerVaultEscalationDeck } from './policies-customer-vault.mjs';
import { createCustomerVaultAnalyticsTimeline, createCustomerVaultForecastEnvelope, createCustomerVaultExceptionLedger, summarizeCustomerVaultAnalytics } from './analytics-customer-vault.mjs';
import { createCustomerVaultOperationsBoard, createCustomerVaultShiftChecklist, createCustomerVaultIncidentDeck } from './operations-customer-vault.mjs';
import { createCustomerVaultReportCards, createCustomerVaultReviewPackets, summarizeCustomerVaultReporting } from './reporting-customer-vault.mjs';
import { createCustomerVaultAuditTrail, createCustomerVaultEvidenceManifest, createCustomerVaultReadinessAttestation } from './audit-customer-vault.mjs';
import { createCustomerVaultPlaybooks, createCustomerVaultDecisionDeck, createCustomerVaultEscalationMoments } from './playbooks-customer-vault.mjs';

export function buildCustomerVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCustomerVaultWorkspace(workspaceName);
  const policies = createCustomerVaultPolicies();
  return {
    workspace,
    summary: summarizeCustomerVaultWorkspace(workspace),
    narratives: createCustomerVaultNarratives(workspace),
    coverage: createCustomerVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeCustomerVaultPolicies(policies),
    validation: validateCustomerVaultPolicies(policies),
    escalationDeck: createCustomerVaultEscalationDeck(policies),
    analytics: {
      timeline: createCustomerVaultAnalyticsTimeline(),
      forecast: createCustomerVaultForecastEnvelope(),
      exceptions: createCustomerVaultExceptionLedger(),
      summary: summarizeCustomerVaultAnalytics()
    },
    operations: {
      board: createCustomerVaultOperationsBoard(),
      checklist: createCustomerVaultShiftChecklist(),
      incidents: createCustomerVaultIncidentDeck()
    },
    reporting: {
      cards: createCustomerVaultReportCards(),
      packets: createCustomerVaultReviewPackets(),
      summary: summarizeCustomerVaultReporting()
    },
    audit: {
      trail: createCustomerVaultAuditTrail(),
      manifest: createCustomerVaultEvidenceManifest(),
      attestation: createCustomerVaultReadinessAttestation()
    },
    playbooks: createCustomerVaultPlaybooks(),
    decisions: createCustomerVaultDecisionDeck(),
    escalationMoments: createCustomerVaultEscalationMoments()
  };
}

export function createCustomerVaultReadinessBoard(snapshot = buildCustomerVaultSnapshot()) {
  return [
    { id: 'customer-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'customer-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'customer-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'customer-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCustomerVaultApiDocument(snapshot = buildCustomerVaultSnapshot()) {
  return {
    id: 'customer-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/customer-vault/overview' },
      { method: 'GET', path: '/api/customer-vault/reporting' },
      { method: 'POST', path: '/api/customer-vault/validate' },
      { method: 'GET', path: '/api/customer-vault/audit' }
    ],
    readiness: createCustomerVaultReadinessBoard(snapshot)
  };
}

export function createCustomerVaultRouteSummary(snapshot = buildCustomerVaultSnapshot()) {
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

