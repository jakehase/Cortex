import { createInsightsVaultWorkspace, summarizeInsightsVaultWorkspace, createInsightsVaultNarratives, createInsightsVaultCoverageGrid } from './domain-insights-vault.mjs';
import { createInsightsVaultPolicies, validateInsightsVaultPolicies, summarizeInsightsVaultPolicies, createInsightsVaultEscalationDeck } from './policies-insights-vault.mjs';
import { createInsightsVaultAnalyticsTimeline, createInsightsVaultForecastEnvelope, createInsightsVaultExceptionLedger, summarizeInsightsVaultAnalytics } from './analytics-insights-vault.mjs';
import { createInsightsVaultOperationsBoard, createInsightsVaultShiftChecklist, createInsightsVaultIncidentDeck } from './operations-insights-vault.mjs';
import { createInsightsVaultReportCards, createInsightsVaultReviewPackets, summarizeInsightsVaultReporting } from './reporting-insights-vault.mjs';
import { createInsightsVaultAuditTrail, createInsightsVaultEvidenceManifest, createInsightsVaultReadinessAttestation } from './audit-insights-vault.mjs';
import { createInsightsVaultPlaybooks, createInsightsVaultDecisionDeck, createInsightsVaultEscalationMoments } from './playbooks-insights-vault.mjs';

export function buildInsightsVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createInsightsVaultWorkspace(workspaceName);
  const policies = createInsightsVaultPolicies();
  return {
    workspace,
    summary: summarizeInsightsVaultWorkspace(workspace),
    narratives: createInsightsVaultNarratives(workspace),
    coverage: createInsightsVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeInsightsVaultPolicies(policies),
    validation: validateInsightsVaultPolicies(policies),
    escalationDeck: createInsightsVaultEscalationDeck(policies),
    analytics: {
      timeline: createInsightsVaultAnalyticsTimeline(),
      forecast: createInsightsVaultForecastEnvelope(),
      exceptions: createInsightsVaultExceptionLedger(),
      summary: summarizeInsightsVaultAnalytics()
    },
    operations: {
      board: createInsightsVaultOperationsBoard(),
      checklist: createInsightsVaultShiftChecklist(),
      incidents: createInsightsVaultIncidentDeck()
    },
    reporting: {
      cards: createInsightsVaultReportCards(),
      packets: createInsightsVaultReviewPackets(),
      summary: summarizeInsightsVaultReporting()
    },
    audit: {
      trail: createInsightsVaultAuditTrail(),
      manifest: createInsightsVaultEvidenceManifest(),
      attestation: createInsightsVaultReadinessAttestation()
    },
    playbooks: createInsightsVaultPlaybooks(),
    decisions: createInsightsVaultDecisionDeck(),
    escalationMoments: createInsightsVaultEscalationMoments()
  };
}

export function createInsightsVaultReadinessBoard(snapshot = buildInsightsVaultSnapshot()) {
  return [
    { id: 'insights-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'insights-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'insights-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'insights-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createInsightsVaultApiDocument(snapshot = buildInsightsVaultSnapshot()) {
  return {
    id: 'insights-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/insights-vault/overview' },
      { method: 'GET', path: '/api/insights-vault/reporting' },
      { method: 'POST', path: '/api/insights-vault/validate' },
      { method: 'GET', path: '/api/insights-vault/audit' }
    ],
    readiness: createInsightsVaultReadinessBoard(snapshot)
  };
}

export function createInsightsVaultRouteSummary(snapshot = buildInsightsVaultSnapshot()) {
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

