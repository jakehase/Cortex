import { createIntegrationsVaultWorkspace, summarizeIntegrationsVaultWorkspace, createIntegrationsVaultNarratives, createIntegrationsVaultCoverageGrid } from './domain-integrations-vault.mjs';
import { createIntegrationsVaultPolicies, validateIntegrationsVaultPolicies, summarizeIntegrationsVaultPolicies, createIntegrationsVaultEscalationDeck } from './policies-integrations-vault.mjs';
import { createIntegrationsVaultAnalyticsTimeline, createIntegrationsVaultForecastEnvelope, createIntegrationsVaultExceptionLedger, summarizeIntegrationsVaultAnalytics } from './analytics-integrations-vault.mjs';
import { createIntegrationsVaultOperationsBoard, createIntegrationsVaultShiftChecklist, createIntegrationsVaultIncidentDeck } from './operations-integrations-vault.mjs';
import { createIntegrationsVaultReportCards, createIntegrationsVaultReviewPackets, summarizeIntegrationsVaultReporting } from './reporting-integrations-vault.mjs';
import { createIntegrationsVaultAuditTrail, createIntegrationsVaultEvidenceManifest, createIntegrationsVaultReadinessAttestation } from './audit-integrations-vault.mjs';
import { createIntegrationsVaultPlaybooks, createIntegrationsVaultDecisionDeck, createIntegrationsVaultEscalationMoments } from './playbooks-integrations-vault.mjs';

export function buildIntegrationsVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createIntegrationsVaultWorkspace(workspaceName);
  const policies = createIntegrationsVaultPolicies();
  return {
    workspace,
    summary: summarizeIntegrationsVaultWorkspace(workspace),
    narratives: createIntegrationsVaultNarratives(workspace),
    coverage: createIntegrationsVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeIntegrationsVaultPolicies(policies),
    validation: validateIntegrationsVaultPolicies(policies),
    escalationDeck: createIntegrationsVaultEscalationDeck(policies),
    analytics: {
      timeline: createIntegrationsVaultAnalyticsTimeline(),
      forecast: createIntegrationsVaultForecastEnvelope(),
      exceptions: createIntegrationsVaultExceptionLedger(),
      summary: summarizeIntegrationsVaultAnalytics()
    },
    operations: {
      board: createIntegrationsVaultOperationsBoard(),
      checklist: createIntegrationsVaultShiftChecklist(),
      incidents: createIntegrationsVaultIncidentDeck()
    },
    reporting: {
      cards: createIntegrationsVaultReportCards(),
      packets: createIntegrationsVaultReviewPackets(),
      summary: summarizeIntegrationsVaultReporting()
    },
    audit: {
      trail: createIntegrationsVaultAuditTrail(),
      manifest: createIntegrationsVaultEvidenceManifest(),
      attestation: createIntegrationsVaultReadinessAttestation()
    },
    playbooks: createIntegrationsVaultPlaybooks(),
    decisions: createIntegrationsVaultDecisionDeck(),
    escalationMoments: createIntegrationsVaultEscalationMoments()
  };
}

export function createIntegrationsVaultReadinessBoard(snapshot = buildIntegrationsVaultSnapshot()) {
  return [
    { id: 'integrations-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'integrations-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'integrations-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'integrations-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createIntegrationsVaultApiDocument(snapshot = buildIntegrationsVaultSnapshot()) {
  return {
    id: 'integrations-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/integrations-vault/overview' },
      { method: 'GET', path: '/api/integrations-vault/reporting' },
      { method: 'POST', path: '/api/integrations-vault/validate' },
      { method: 'GET', path: '/api/integrations-vault/audit' }
    ],
    readiness: createIntegrationsVaultReadinessBoard(snapshot)
  };
}

export function createIntegrationsVaultRouteSummary(snapshot = buildIntegrationsVaultSnapshot()) {
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

