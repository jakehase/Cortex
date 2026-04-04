import { createContentVaultWorkspace, summarizeContentVaultWorkspace, createContentVaultNarratives, createContentVaultCoverageGrid } from './domain-content-vault.mjs';
import { createContentVaultPolicies, validateContentVaultPolicies, summarizeContentVaultPolicies, createContentVaultEscalationDeck } from './policies-content-vault.mjs';
import { createContentVaultAnalyticsTimeline, createContentVaultForecastEnvelope, createContentVaultExceptionLedger, summarizeContentVaultAnalytics } from './analytics-content-vault.mjs';
import { createContentVaultOperationsBoard, createContentVaultShiftChecklist, createContentVaultIncidentDeck } from './operations-content-vault.mjs';
import { createContentVaultReportCards, createContentVaultReviewPackets, summarizeContentVaultReporting } from './reporting-content-vault.mjs';
import { createContentVaultAuditTrail, createContentVaultEvidenceManifest, createContentVaultReadinessAttestation } from './audit-content-vault.mjs';
import { createContentVaultPlaybooks, createContentVaultDecisionDeck, createContentVaultEscalationMoments } from './playbooks-content-vault.mjs';

export function buildContentVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentVaultWorkspace(workspaceName);
  const policies = createContentVaultPolicies();
  return {
    workspace,
    summary: summarizeContentVaultWorkspace(workspace),
    narratives: createContentVaultNarratives(workspace),
    coverage: createContentVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentVaultPolicies(policies),
    validation: validateContentVaultPolicies(policies),
    escalationDeck: createContentVaultEscalationDeck(policies),
    analytics: {
      timeline: createContentVaultAnalyticsTimeline(),
      forecast: createContentVaultForecastEnvelope(),
      exceptions: createContentVaultExceptionLedger(),
      summary: summarizeContentVaultAnalytics()
    },
    operations: {
      board: createContentVaultOperationsBoard(),
      checklist: createContentVaultShiftChecklist(),
      incidents: createContentVaultIncidentDeck()
    },
    reporting: {
      cards: createContentVaultReportCards(),
      packets: createContentVaultReviewPackets(),
      summary: summarizeContentVaultReporting()
    },
    audit: {
      trail: createContentVaultAuditTrail(),
      manifest: createContentVaultEvidenceManifest(),
      attestation: createContentVaultReadinessAttestation()
    },
    playbooks: createContentVaultPlaybooks(),
    decisions: createContentVaultDecisionDeck(),
    escalationMoments: createContentVaultEscalationMoments()
  };
}

export function createContentVaultReadinessBoard(snapshot = buildContentVaultSnapshot()) {
  return [
    { id: 'content-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentVaultApiDocument(snapshot = buildContentVaultSnapshot()) {
  return {
    id: 'content-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-vault/overview' },
      { method: 'GET', path: '/api/content-vault/reporting' },
      { method: 'POST', path: '/api/content-vault/validate' },
      { method: 'GET', path: '/api/content-vault/audit' }
    ],
    readiness: createContentVaultReadinessBoard(snapshot)
  };
}

export function createContentVaultRouteSummary(snapshot = buildContentVaultSnapshot()) {
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

