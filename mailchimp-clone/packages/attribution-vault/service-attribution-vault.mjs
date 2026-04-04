import { createAttributionVaultWorkspace, summarizeAttributionVaultWorkspace, createAttributionVaultNarratives, createAttributionVaultCoverageGrid } from './domain-attribution-vault.mjs';
import { createAttributionVaultPolicies, validateAttributionVaultPolicies, summarizeAttributionVaultPolicies, createAttributionVaultEscalationDeck } from './policies-attribution-vault.mjs';
import { createAttributionVaultAnalyticsTimeline, createAttributionVaultForecastEnvelope, createAttributionVaultExceptionLedger, summarizeAttributionVaultAnalytics } from './analytics-attribution-vault.mjs';
import { createAttributionVaultOperationsBoard, createAttributionVaultShiftChecklist, createAttributionVaultIncidentDeck } from './operations-attribution-vault.mjs';
import { createAttributionVaultReportCards, createAttributionVaultReviewPackets, summarizeAttributionVaultReporting } from './reporting-attribution-vault.mjs';
import { createAttributionVaultAuditTrail, createAttributionVaultEvidenceManifest, createAttributionVaultReadinessAttestation } from './audit-attribution-vault.mjs';
import { createAttributionVaultPlaybooks, createAttributionVaultDecisionDeck, createAttributionVaultEscalationMoments } from './playbooks-attribution-vault.mjs';

export function buildAttributionVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionVaultWorkspace(workspaceName);
  const policies = createAttributionVaultPolicies();
  return {
    workspace,
    summary: summarizeAttributionVaultWorkspace(workspace),
    narratives: createAttributionVaultNarratives(workspace),
    coverage: createAttributionVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionVaultPolicies(policies),
    validation: validateAttributionVaultPolicies(policies),
    escalationDeck: createAttributionVaultEscalationDeck(policies),
    analytics: {
      timeline: createAttributionVaultAnalyticsTimeline(),
      forecast: createAttributionVaultForecastEnvelope(),
      exceptions: createAttributionVaultExceptionLedger(),
      summary: summarizeAttributionVaultAnalytics()
    },
    operations: {
      board: createAttributionVaultOperationsBoard(),
      checklist: createAttributionVaultShiftChecklist(),
      incidents: createAttributionVaultIncidentDeck()
    },
    reporting: {
      cards: createAttributionVaultReportCards(),
      packets: createAttributionVaultReviewPackets(),
      summary: summarizeAttributionVaultReporting()
    },
    audit: {
      trail: createAttributionVaultAuditTrail(),
      manifest: createAttributionVaultEvidenceManifest(),
      attestation: createAttributionVaultReadinessAttestation()
    },
    playbooks: createAttributionVaultPlaybooks(),
    decisions: createAttributionVaultDecisionDeck(),
    escalationMoments: createAttributionVaultEscalationMoments()
  };
}

export function createAttributionVaultReadinessBoard(snapshot = buildAttributionVaultSnapshot()) {
  return [
    { id: 'attribution-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionVaultApiDocument(snapshot = buildAttributionVaultSnapshot()) {
  return {
    id: 'attribution-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-vault/overview' },
      { method: 'GET', path: '/api/attribution-vault/reporting' },
      { method: 'POST', path: '/api/attribution-vault/validate' },
      { method: 'GET', path: '/api/attribution-vault/audit' }
    ],
    readiness: createAttributionVaultReadinessBoard(snapshot)
  };
}

export function createAttributionVaultRouteSummary(snapshot = buildAttributionVaultSnapshot()) {
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

