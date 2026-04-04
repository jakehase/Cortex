import { createEcommerceVaultWorkspace, summarizeEcommerceVaultWorkspace, createEcommerceVaultNarratives, createEcommerceVaultCoverageGrid } from './domain-ecommerce-vault.mjs';
import { createEcommerceVaultPolicies, validateEcommerceVaultPolicies, summarizeEcommerceVaultPolicies, createEcommerceVaultEscalationDeck } from './policies-ecommerce-vault.mjs';
import { createEcommerceVaultAnalyticsTimeline, createEcommerceVaultForecastEnvelope, createEcommerceVaultExceptionLedger, summarizeEcommerceVaultAnalytics } from './analytics-ecommerce-vault.mjs';
import { createEcommerceVaultOperationsBoard, createEcommerceVaultShiftChecklist, createEcommerceVaultIncidentDeck } from './operations-ecommerce-vault.mjs';
import { createEcommerceVaultReportCards, createEcommerceVaultReviewPackets, summarizeEcommerceVaultReporting } from './reporting-ecommerce-vault.mjs';
import { createEcommerceVaultAuditTrail, createEcommerceVaultEvidenceManifest, createEcommerceVaultReadinessAttestation } from './audit-ecommerce-vault.mjs';
import { createEcommerceVaultPlaybooks, createEcommerceVaultDecisionDeck, createEcommerceVaultEscalationMoments } from './playbooks-ecommerce-vault.mjs';

export function buildEcommerceVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createEcommerceVaultWorkspace(workspaceName);
  const policies = createEcommerceVaultPolicies();
  return {
    workspace,
    summary: summarizeEcommerceVaultWorkspace(workspace),
    narratives: createEcommerceVaultNarratives(workspace),
    coverage: createEcommerceVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeEcommerceVaultPolicies(policies),
    validation: validateEcommerceVaultPolicies(policies),
    escalationDeck: createEcommerceVaultEscalationDeck(policies),
    analytics: {
      timeline: createEcommerceVaultAnalyticsTimeline(),
      forecast: createEcommerceVaultForecastEnvelope(),
      exceptions: createEcommerceVaultExceptionLedger(),
      summary: summarizeEcommerceVaultAnalytics()
    },
    operations: {
      board: createEcommerceVaultOperationsBoard(),
      checklist: createEcommerceVaultShiftChecklist(),
      incidents: createEcommerceVaultIncidentDeck()
    },
    reporting: {
      cards: createEcommerceVaultReportCards(),
      packets: createEcommerceVaultReviewPackets(),
      summary: summarizeEcommerceVaultReporting()
    },
    audit: {
      trail: createEcommerceVaultAuditTrail(),
      manifest: createEcommerceVaultEvidenceManifest(),
      attestation: createEcommerceVaultReadinessAttestation()
    },
    playbooks: createEcommerceVaultPlaybooks(),
    decisions: createEcommerceVaultDecisionDeck(),
    escalationMoments: createEcommerceVaultEscalationMoments()
  };
}

export function createEcommerceVaultReadinessBoard(snapshot = buildEcommerceVaultSnapshot()) {
  return [
    { id: 'ecommerce-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'ecommerce-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'ecommerce-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'ecommerce-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createEcommerceVaultApiDocument(snapshot = buildEcommerceVaultSnapshot()) {
  return {
    id: 'ecommerce-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-vault/overview' },
      { method: 'GET', path: '/api/ecommerce-vault/reporting' },
      { method: 'POST', path: '/api/ecommerce-vault/validate' },
      { method: 'GET', path: '/api/ecommerce-vault/audit' }
    ],
    readiness: createEcommerceVaultReadinessBoard(snapshot)
  };
}

export function createEcommerceVaultRouteSummary(snapshot = buildEcommerceVaultSnapshot()) {
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

