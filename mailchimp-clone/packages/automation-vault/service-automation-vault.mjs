import { createAutomationVaultWorkspace, summarizeAutomationVaultWorkspace, createAutomationVaultNarratives, createAutomationVaultCoverageGrid } from './domain-automation-vault.mjs';
import { createAutomationVaultPolicies, validateAutomationVaultPolicies, summarizeAutomationVaultPolicies, createAutomationVaultEscalationDeck } from './policies-automation-vault.mjs';
import { createAutomationVaultAnalyticsTimeline, createAutomationVaultForecastEnvelope, createAutomationVaultExceptionLedger, summarizeAutomationVaultAnalytics } from './analytics-automation-vault.mjs';
import { createAutomationVaultOperationsBoard, createAutomationVaultShiftChecklist, createAutomationVaultIncidentDeck } from './operations-automation-vault.mjs';
import { createAutomationVaultReportCards, createAutomationVaultReviewPackets, summarizeAutomationVaultReporting } from './reporting-automation-vault.mjs';
import { createAutomationVaultAuditTrail, createAutomationVaultEvidenceManifest, createAutomationVaultReadinessAttestation } from './audit-automation-vault.mjs';
import { createAutomationVaultPlaybooks, createAutomationVaultDecisionDeck, createAutomationVaultEscalationMoments } from './playbooks-automation-vault.mjs';

export function buildAutomationVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationVaultWorkspace(workspaceName);
  const policies = createAutomationVaultPolicies();
  return {
    workspace,
    summary: summarizeAutomationVaultWorkspace(workspace),
    narratives: createAutomationVaultNarratives(workspace),
    coverage: createAutomationVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationVaultPolicies(policies),
    validation: validateAutomationVaultPolicies(policies),
    escalationDeck: createAutomationVaultEscalationDeck(policies),
    analytics: {
      timeline: createAutomationVaultAnalyticsTimeline(),
      forecast: createAutomationVaultForecastEnvelope(),
      exceptions: createAutomationVaultExceptionLedger(),
      summary: summarizeAutomationVaultAnalytics()
    },
    operations: {
      board: createAutomationVaultOperationsBoard(),
      checklist: createAutomationVaultShiftChecklist(),
      incidents: createAutomationVaultIncidentDeck()
    },
    reporting: {
      cards: createAutomationVaultReportCards(),
      packets: createAutomationVaultReviewPackets(),
      summary: summarizeAutomationVaultReporting()
    },
    audit: {
      trail: createAutomationVaultAuditTrail(),
      manifest: createAutomationVaultEvidenceManifest(),
      attestation: createAutomationVaultReadinessAttestation()
    },
    playbooks: createAutomationVaultPlaybooks(),
    decisions: createAutomationVaultDecisionDeck(),
    escalationMoments: createAutomationVaultEscalationMoments()
  };
}

export function createAutomationVaultReadinessBoard(snapshot = buildAutomationVaultSnapshot()) {
  return [
    { id: 'automation-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationVaultApiDocument(snapshot = buildAutomationVaultSnapshot()) {
  return {
    id: 'automation-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-vault/overview' },
      { method: 'GET', path: '/api/automation-vault/reporting' },
      { method: 'POST', path: '/api/automation-vault/validate' },
      { method: 'GET', path: '/api/automation-vault/audit' }
    ],
    readiness: createAutomationVaultReadinessBoard(snapshot)
  };
}

export function createAutomationVaultRouteSummary(snapshot = buildAutomationVaultSnapshot()) {
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

