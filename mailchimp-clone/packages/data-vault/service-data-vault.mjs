import { createDataVaultWorkspace, summarizeDataVaultWorkspace, createDataVaultNarratives, createDataVaultCoverageGrid } from './domain-data-vault.mjs';
import { createDataVaultPolicies, validateDataVaultPolicies, summarizeDataVaultPolicies, createDataVaultEscalationDeck } from './policies-data-vault.mjs';
import { createDataVaultAnalyticsTimeline, createDataVaultForecastEnvelope, createDataVaultExceptionLedger, summarizeDataVaultAnalytics } from './analytics-data-vault.mjs';
import { createDataVaultOperationsBoard, createDataVaultShiftChecklist, createDataVaultIncidentDeck } from './operations-data-vault.mjs';
import { createDataVaultReportCards, createDataVaultReviewPackets, summarizeDataVaultReporting } from './reporting-data-vault.mjs';
import { createDataVaultAuditTrail, createDataVaultEvidenceManifest, createDataVaultReadinessAttestation } from './audit-data-vault.mjs';
import { createDataVaultPlaybooks, createDataVaultDecisionDeck, createDataVaultEscalationMoments } from './playbooks-data-vault.mjs';

export function buildDataVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDataVaultWorkspace(workspaceName);
  const policies = createDataVaultPolicies();
  return {
    workspace,
    summary: summarizeDataVaultWorkspace(workspace),
    narratives: createDataVaultNarratives(workspace),
    coverage: createDataVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeDataVaultPolicies(policies),
    validation: validateDataVaultPolicies(policies),
    escalationDeck: createDataVaultEscalationDeck(policies),
    analytics: {
      timeline: createDataVaultAnalyticsTimeline(),
      forecast: createDataVaultForecastEnvelope(),
      exceptions: createDataVaultExceptionLedger(),
      summary: summarizeDataVaultAnalytics()
    },
    operations: {
      board: createDataVaultOperationsBoard(),
      checklist: createDataVaultShiftChecklist(),
      incidents: createDataVaultIncidentDeck()
    },
    reporting: {
      cards: createDataVaultReportCards(),
      packets: createDataVaultReviewPackets(),
      summary: summarizeDataVaultReporting()
    },
    audit: {
      trail: createDataVaultAuditTrail(),
      manifest: createDataVaultEvidenceManifest(),
      attestation: createDataVaultReadinessAttestation()
    },
    playbooks: createDataVaultPlaybooks(),
    decisions: createDataVaultDecisionDeck(),
    escalationMoments: createDataVaultEscalationMoments()
  };
}

export function createDataVaultReadinessBoard(snapshot = buildDataVaultSnapshot()) {
  return [
    { id: 'data-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'data-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'data-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'data-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDataVaultApiDocument(snapshot = buildDataVaultSnapshot()) {
  return {
    id: 'data-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/data-vault/overview' },
      { method: 'GET', path: '/api/data-vault/reporting' },
      { method: 'POST', path: '/api/data-vault/validate' },
      { method: 'GET', path: '/api/data-vault/audit' }
    ],
    readiness: createDataVaultReadinessBoard(snapshot)
  };
}

export function createDataVaultRouteSummary(snapshot = buildDataVaultSnapshot()) {
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

