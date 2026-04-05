import { createAnalyticsVaultWorkspace, summarizeAnalyticsVaultWorkspace, createAnalyticsVaultNarratives, createAnalyticsVaultCoverageGrid } from './domain-analytics-vault.mjs';
import { createAnalyticsVaultPolicies, validateAnalyticsVaultPolicies, summarizeAnalyticsVaultPolicies, createAnalyticsVaultEscalationDeck } from './policies-analytics-vault.mjs';
import { createAnalyticsVaultAnalyticsTimeline, createAnalyticsVaultForecastEnvelope, createAnalyticsVaultExceptionLedger, summarizeAnalyticsVaultAnalytics } from './analytics-analytics-vault.mjs';
import { createAnalyticsVaultOperationsBoard, createAnalyticsVaultShiftChecklist, createAnalyticsVaultIncidentDeck } from './operations-analytics-vault.mjs';
import { createAnalyticsVaultReportCards, createAnalyticsVaultReviewPackets, summarizeAnalyticsVaultReporting } from './reporting-analytics-vault.mjs';
import { createAnalyticsVaultAuditTrail, createAnalyticsVaultEvidenceManifest, createAnalyticsVaultReadinessAttestation } from './audit-analytics-vault.mjs';
import { createAnalyticsVaultPlaybooks, createAnalyticsVaultDecisionDeck, createAnalyticsVaultEscalationMoments } from './playbooks-analytics-vault.mjs';

export function buildAnalyticsVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsVaultWorkspace(workspaceName);
  const policies = createAnalyticsVaultPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsVaultWorkspace(workspace),
    narratives: createAnalyticsVaultNarratives(workspace),
    coverage: createAnalyticsVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsVaultPolicies(policies),
    validation: validateAnalyticsVaultPolicies(policies),
    escalationDeck: createAnalyticsVaultEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsVaultAnalyticsTimeline(),
      forecast: createAnalyticsVaultForecastEnvelope(),
      exceptions: createAnalyticsVaultExceptionLedger(),
      summary: summarizeAnalyticsVaultAnalytics()
    },
    operations: {
      board: createAnalyticsVaultOperationsBoard(),
      checklist: createAnalyticsVaultShiftChecklist(),
      incidents: createAnalyticsVaultIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsVaultReportCards(),
      packets: createAnalyticsVaultReviewPackets(),
      summary: summarizeAnalyticsVaultReporting()
    },
    audit: {
      trail: createAnalyticsVaultAuditTrail(),
      manifest: createAnalyticsVaultEvidenceManifest(),
      attestation: createAnalyticsVaultReadinessAttestation()
    },
    playbooks: createAnalyticsVaultPlaybooks(),
    decisions: createAnalyticsVaultDecisionDeck(),
    escalationMoments: createAnalyticsVaultEscalationMoments()
  };
}

export function createAnalyticsVaultReadinessBoard(snapshot = buildAnalyticsVaultSnapshot()) {
  return [
    { id: 'analytics-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsVaultApiDocument(snapshot = buildAnalyticsVaultSnapshot()) {
  return {
    id: 'analytics-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-vault/overview' },
      { method: 'GET', path: '/api/analytics-vault/reporting' },
      { method: 'POST', path: '/api/analytics-vault/validate' },
      { method: 'GET', path: '/api/analytics-vault/audit' }
    ],
    readiness: createAnalyticsVaultReadinessBoard(snapshot)
  };
}

export function createAnalyticsVaultRouteSummary(snapshot = buildAnalyticsVaultSnapshot()) {
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

