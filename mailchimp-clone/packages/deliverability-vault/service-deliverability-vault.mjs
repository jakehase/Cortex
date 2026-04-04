import { createDeliverabilityVaultWorkspace, summarizeDeliverabilityVaultWorkspace, createDeliverabilityVaultNarratives, createDeliverabilityVaultCoverageGrid } from './domain-deliverability-vault.mjs';
import { createDeliverabilityVaultPolicies, validateDeliverabilityVaultPolicies, summarizeDeliverabilityVaultPolicies, createDeliverabilityVaultEscalationDeck } from './policies-deliverability-vault.mjs';
import { createDeliverabilityVaultAnalyticsTimeline, createDeliverabilityVaultForecastEnvelope, createDeliverabilityVaultExceptionLedger, summarizeDeliverabilityVaultAnalytics } from './analytics-deliverability-vault.mjs';
import { createDeliverabilityVaultOperationsBoard, createDeliverabilityVaultShiftChecklist, createDeliverabilityVaultIncidentDeck } from './operations-deliverability-vault.mjs';
import { createDeliverabilityVaultReportCards, createDeliverabilityVaultReviewPackets, summarizeDeliverabilityVaultReporting } from './reporting-deliverability-vault.mjs';
import { createDeliverabilityVaultAuditTrail, createDeliverabilityVaultEvidenceManifest, createDeliverabilityVaultReadinessAttestation } from './audit-deliverability-vault.mjs';
import { createDeliverabilityVaultPlaybooks, createDeliverabilityVaultDecisionDeck, createDeliverabilityVaultEscalationMoments } from './playbooks-deliverability-vault.mjs';

export function buildDeliverabilityVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createDeliverabilityVaultWorkspace(workspaceName);
  const policies = createDeliverabilityVaultPolicies();
  return {
    workspace,
    summary: summarizeDeliverabilityVaultWorkspace(workspace),
    narratives: createDeliverabilityVaultNarratives(workspace),
    coverage: createDeliverabilityVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeDeliverabilityVaultPolicies(policies),
    validation: validateDeliverabilityVaultPolicies(policies),
    escalationDeck: createDeliverabilityVaultEscalationDeck(policies),
    analytics: {
      timeline: createDeliverabilityVaultAnalyticsTimeline(),
      forecast: createDeliverabilityVaultForecastEnvelope(),
      exceptions: createDeliverabilityVaultExceptionLedger(),
      summary: summarizeDeliverabilityVaultAnalytics()
    },
    operations: {
      board: createDeliverabilityVaultOperationsBoard(),
      checklist: createDeliverabilityVaultShiftChecklist(),
      incidents: createDeliverabilityVaultIncidentDeck()
    },
    reporting: {
      cards: createDeliverabilityVaultReportCards(),
      packets: createDeliverabilityVaultReviewPackets(),
      summary: summarizeDeliverabilityVaultReporting()
    },
    audit: {
      trail: createDeliverabilityVaultAuditTrail(),
      manifest: createDeliverabilityVaultEvidenceManifest(),
      attestation: createDeliverabilityVaultReadinessAttestation()
    },
    playbooks: createDeliverabilityVaultPlaybooks(),
    decisions: createDeliverabilityVaultDecisionDeck(),
    escalationMoments: createDeliverabilityVaultEscalationMoments()
  };
}

export function createDeliverabilityVaultReadinessBoard(snapshot = buildDeliverabilityVaultSnapshot()) {
  return [
    { id: 'deliverability-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'deliverability-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'deliverability-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'deliverability-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createDeliverabilityVaultApiDocument(snapshot = buildDeliverabilityVaultSnapshot()) {
  return {
    id: 'deliverability-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/deliverability-vault/overview' },
      { method: 'GET', path: '/api/deliverability-vault/reporting' },
      { method: 'POST', path: '/api/deliverability-vault/validate' },
      { method: 'GET', path: '/api/deliverability-vault/audit' }
    ],
    readiness: createDeliverabilityVaultReadinessBoard(snapshot)
  };
}

export function createDeliverabilityVaultRouteSummary(snapshot = buildDeliverabilityVaultSnapshot()) {
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

