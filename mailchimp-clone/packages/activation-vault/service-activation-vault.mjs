import { createActivationVaultWorkspace, summarizeActivationVaultWorkspace, createActivationVaultNarratives, createActivationVaultCoverageGrid } from './domain-activation-vault.mjs';
import { createActivationVaultPolicies, validateActivationVaultPolicies, summarizeActivationVaultPolicies, createActivationVaultEscalationDeck } from './policies-activation-vault.mjs';
import { createActivationVaultAnalyticsTimeline, createActivationVaultForecastEnvelope, createActivationVaultExceptionLedger, summarizeActivationVaultAnalytics } from './analytics-activation-vault.mjs';
import { createActivationVaultOperationsBoard, createActivationVaultShiftChecklist, createActivationVaultIncidentDeck } from './operations-activation-vault.mjs';
import { createActivationVaultReportCards, createActivationVaultReviewPackets, summarizeActivationVaultReporting } from './reporting-activation-vault.mjs';
import { createActivationVaultAuditTrail, createActivationVaultEvidenceManifest, createActivationVaultReadinessAttestation } from './audit-activation-vault.mjs';
import { createActivationVaultPlaybooks, createActivationVaultDecisionDeck, createActivationVaultEscalationMoments } from './playbooks-activation-vault.mjs';

export function buildActivationVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createActivationVaultWorkspace(workspaceName);
  const policies = createActivationVaultPolicies();
  return {
    workspace,
    summary: summarizeActivationVaultWorkspace(workspace),
    narratives: createActivationVaultNarratives(workspace),
    coverage: createActivationVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeActivationVaultPolicies(policies),
    validation: validateActivationVaultPolicies(policies),
    escalationDeck: createActivationVaultEscalationDeck(policies),
    analytics: {
      timeline: createActivationVaultAnalyticsTimeline(),
      forecast: createActivationVaultForecastEnvelope(),
      exceptions: createActivationVaultExceptionLedger(),
      summary: summarizeActivationVaultAnalytics()
    },
    operations: {
      board: createActivationVaultOperationsBoard(),
      checklist: createActivationVaultShiftChecklist(),
      incidents: createActivationVaultIncidentDeck()
    },
    reporting: {
      cards: createActivationVaultReportCards(),
      packets: createActivationVaultReviewPackets(),
      summary: summarizeActivationVaultReporting()
    },
    audit: {
      trail: createActivationVaultAuditTrail(),
      manifest: createActivationVaultEvidenceManifest(),
      attestation: createActivationVaultReadinessAttestation()
    },
    playbooks: createActivationVaultPlaybooks(),
    decisions: createActivationVaultDecisionDeck(),
    escalationMoments: createActivationVaultEscalationMoments()
  };
}

export function createActivationVaultReadinessBoard(snapshot = buildActivationVaultSnapshot()) {
  return [
    { id: 'activation-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'activation-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'activation-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'activation-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createActivationVaultApiDocument(snapshot = buildActivationVaultSnapshot()) {
  return {
    id: 'activation-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/activation-vault/overview' },
      { method: 'GET', path: '/api/activation-vault/reporting' },
      { method: 'POST', path: '/api/activation-vault/validate' },
      { method: 'GET', path: '/api/activation-vault/audit' }
    ],
    readiness: createActivationVaultReadinessBoard(snapshot)
  };
}

export function createActivationVaultRouteSummary(snapshot = buildActivationVaultSnapshot()) {
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

