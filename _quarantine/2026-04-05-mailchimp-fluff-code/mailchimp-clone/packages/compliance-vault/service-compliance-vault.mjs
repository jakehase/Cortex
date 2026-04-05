import { createComplianceVaultWorkspace, summarizeComplianceVaultWorkspace, createComplianceVaultNarratives, createComplianceVaultCoverageGrid } from './domain-compliance-vault.mjs';
import { createComplianceVaultPolicies, validateComplianceVaultPolicies, summarizeComplianceVaultPolicies, createComplianceVaultEscalationDeck } from './policies-compliance-vault.mjs';
import { createComplianceVaultAnalyticsTimeline, createComplianceVaultForecastEnvelope, createComplianceVaultExceptionLedger, summarizeComplianceVaultAnalytics } from './analytics-compliance-vault.mjs';
import { createComplianceVaultOperationsBoard, createComplianceVaultShiftChecklist, createComplianceVaultIncidentDeck } from './operations-compliance-vault.mjs';
import { createComplianceVaultReportCards, createComplianceVaultReviewPackets, summarizeComplianceVaultReporting } from './reporting-compliance-vault.mjs';
import { createComplianceVaultAuditTrail, createComplianceVaultEvidenceManifest, createComplianceVaultReadinessAttestation } from './audit-compliance-vault.mjs';
import { createComplianceVaultPlaybooks, createComplianceVaultDecisionDeck, createComplianceVaultEscalationMoments } from './playbooks-compliance-vault.mjs';

export function buildComplianceVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createComplianceVaultWorkspace(workspaceName);
  const policies = createComplianceVaultPolicies();
  return {
    workspace,
    summary: summarizeComplianceVaultWorkspace(workspace),
    narratives: createComplianceVaultNarratives(workspace),
    coverage: createComplianceVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeComplianceVaultPolicies(policies),
    validation: validateComplianceVaultPolicies(policies),
    escalationDeck: createComplianceVaultEscalationDeck(policies),
    analytics: {
      timeline: createComplianceVaultAnalyticsTimeline(),
      forecast: createComplianceVaultForecastEnvelope(),
      exceptions: createComplianceVaultExceptionLedger(),
      summary: summarizeComplianceVaultAnalytics()
    },
    operations: {
      board: createComplianceVaultOperationsBoard(),
      checklist: createComplianceVaultShiftChecklist(),
      incidents: createComplianceVaultIncidentDeck()
    },
    reporting: {
      cards: createComplianceVaultReportCards(),
      packets: createComplianceVaultReviewPackets(),
      summary: summarizeComplianceVaultReporting()
    },
    audit: {
      trail: createComplianceVaultAuditTrail(),
      manifest: createComplianceVaultEvidenceManifest(),
      attestation: createComplianceVaultReadinessAttestation()
    },
    playbooks: createComplianceVaultPlaybooks(),
    decisions: createComplianceVaultDecisionDeck(),
    escalationMoments: createComplianceVaultEscalationMoments()
  };
}

export function createComplianceVaultReadinessBoard(snapshot = buildComplianceVaultSnapshot()) {
  return [
    { id: 'compliance-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'compliance-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'compliance-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'compliance-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createComplianceVaultApiDocument(snapshot = buildComplianceVaultSnapshot()) {
  return {
    id: 'compliance-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/compliance-vault/overview' },
      { method: 'GET', path: '/api/compliance-vault/reporting' },
      { method: 'POST', path: '/api/compliance-vault/validate' },
      { method: 'GET', path: '/api/compliance-vault/audit' }
    ],
    readiness: createComplianceVaultReadinessBoard(snapshot)
  };
}

export function createComplianceVaultRouteSummary(snapshot = buildComplianceVaultSnapshot()) {
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

