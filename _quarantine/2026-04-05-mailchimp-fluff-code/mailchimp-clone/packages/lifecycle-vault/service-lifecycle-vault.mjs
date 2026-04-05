import { createLifecycleVaultWorkspace, summarizeLifecycleVaultWorkspace, createLifecycleVaultNarratives, createLifecycleVaultCoverageGrid } from './domain-lifecycle-vault.mjs';
import { createLifecycleVaultPolicies, validateLifecycleVaultPolicies, summarizeLifecycleVaultPolicies, createLifecycleVaultEscalationDeck } from './policies-lifecycle-vault.mjs';
import { createLifecycleVaultAnalyticsTimeline, createLifecycleVaultForecastEnvelope, createLifecycleVaultExceptionLedger, summarizeLifecycleVaultAnalytics } from './analytics-lifecycle-vault.mjs';
import { createLifecycleVaultOperationsBoard, createLifecycleVaultShiftChecklist, createLifecycleVaultIncidentDeck } from './operations-lifecycle-vault.mjs';
import { createLifecycleVaultReportCards, createLifecycleVaultReviewPackets, summarizeLifecycleVaultReporting } from './reporting-lifecycle-vault.mjs';
import { createLifecycleVaultAuditTrail, createLifecycleVaultEvidenceManifest, createLifecycleVaultReadinessAttestation } from './audit-lifecycle-vault.mjs';
import { createLifecycleVaultPlaybooks, createLifecycleVaultDecisionDeck, createLifecycleVaultEscalationMoments } from './playbooks-lifecycle-vault.mjs';

export function buildLifecycleVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLifecycleVaultWorkspace(workspaceName);
  const policies = createLifecycleVaultPolicies();
  return {
    workspace,
    summary: summarizeLifecycleVaultWorkspace(workspace),
    narratives: createLifecycleVaultNarratives(workspace),
    coverage: createLifecycleVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeLifecycleVaultPolicies(policies),
    validation: validateLifecycleVaultPolicies(policies),
    escalationDeck: createLifecycleVaultEscalationDeck(policies),
    analytics: {
      timeline: createLifecycleVaultAnalyticsTimeline(),
      forecast: createLifecycleVaultForecastEnvelope(),
      exceptions: createLifecycleVaultExceptionLedger(),
      summary: summarizeLifecycleVaultAnalytics()
    },
    operations: {
      board: createLifecycleVaultOperationsBoard(),
      checklist: createLifecycleVaultShiftChecklist(),
      incidents: createLifecycleVaultIncidentDeck()
    },
    reporting: {
      cards: createLifecycleVaultReportCards(),
      packets: createLifecycleVaultReviewPackets(),
      summary: summarizeLifecycleVaultReporting()
    },
    audit: {
      trail: createLifecycleVaultAuditTrail(),
      manifest: createLifecycleVaultEvidenceManifest(),
      attestation: createLifecycleVaultReadinessAttestation()
    },
    playbooks: createLifecycleVaultPlaybooks(),
    decisions: createLifecycleVaultDecisionDeck(),
    escalationMoments: createLifecycleVaultEscalationMoments()
  };
}

export function createLifecycleVaultReadinessBoard(snapshot = buildLifecycleVaultSnapshot()) {
  return [
    { id: 'lifecycle-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'lifecycle-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'lifecycle-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'lifecycle-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLifecycleVaultApiDocument(snapshot = buildLifecycleVaultSnapshot()) {
  return {
    id: 'lifecycle-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/lifecycle-vault/overview' },
      { method: 'GET', path: '/api/lifecycle-vault/reporting' },
      { method: 'POST', path: '/api/lifecycle-vault/validate' },
      { method: 'GET', path: '/api/lifecycle-vault/audit' }
    ],
    readiness: createLifecycleVaultReadinessBoard(snapshot)
  };
}

export function createLifecycleVaultRouteSummary(snapshot = buildLifecycleVaultSnapshot()) {
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

