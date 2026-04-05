import { createCreativeVaultWorkspace, summarizeCreativeVaultWorkspace, createCreativeVaultNarratives, createCreativeVaultCoverageGrid } from './domain-creative-vault.mjs';
import { createCreativeVaultPolicies, validateCreativeVaultPolicies, summarizeCreativeVaultPolicies, createCreativeVaultEscalationDeck } from './policies-creative-vault.mjs';
import { createCreativeVaultAnalyticsTimeline, createCreativeVaultForecastEnvelope, createCreativeVaultExceptionLedger, summarizeCreativeVaultAnalytics } from './analytics-creative-vault.mjs';
import { createCreativeVaultOperationsBoard, createCreativeVaultShiftChecklist, createCreativeVaultIncidentDeck } from './operations-creative-vault.mjs';
import { createCreativeVaultReportCards, createCreativeVaultReviewPackets, summarizeCreativeVaultReporting } from './reporting-creative-vault.mjs';
import { createCreativeVaultAuditTrail, createCreativeVaultEvidenceManifest, createCreativeVaultReadinessAttestation } from './audit-creative-vault.mjs';
import { createCreativeVaultPlaybooks, createCreativeVaultDecisionDeck, createCreativeVaultEscalationMoments } from './playbooks-creative-vault.mjs';

export function buildCreativeVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeVaultWorkspace(workspaceName);
  const policies = createCreativeVaultPolicies();
  return {
    workspace,
    summary: summarizeCreativeVaultWorkspace(workspace),
    narratives: createCreativeVaultNarratives(workspace),
    coverage: createCreativeVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeVaultPolicies(policies),
    validation: validateCreativeVaultPolicies(policies),
    escalationDeck: createCreativeVaultEscalationDeck(policies),
    analytics: {
      timeline: createCreativeVaultAnalyticsTimeline(),
      forecast: createCreativeVaultForecastEnvelope(),
      exceptions: createCreativeVaultExceptionLedger(),
      summary: summarizeCreativeVaultAnalytics()
    },
    operations: {
      board: createCreativeVaultOperationsBoard(),
      checklist: createCreativeVaultShiftChecklist(),
      incidents: createCreativeVaultIncidentDeck()
    },
    reporting: {
      cards: createCreativeVaultReportCards(),
      packets: createCreativeVaultReviewPackets(),
      summary: summarizeCreativeVaultReporting()
    },
    audit: {
      trail: createCreativeVaultAuditTrail(),
      manifest: createCreativeVaultEvidenceManifest(),
      attestation: createCreativeVaultReadinessAttestation()
    },
    playbooks: createCreativeVaultPlaybooks(),
    decisions: createCreativeVaultDecisionDeck(),
    escalationMoments: createCreativeVaultEscalationMoments()
  };
}

export function createCreativeVaultReadinessBoard(snapshot = buildCreativeVaultSnapshot()) {
  return [
    { id: 'creative-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeVaultApiDocument(snapshot = buildCreativeVaultSnapshot()) {
  return {
    id: 'creative-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-vault/overview' },
      { method: 'GET', path: '/api/creative-vault/reporting' },
      { method: 'POST', path: '/api/creative-vault/validate' },
      { method: 'GET', path: '/api/creative-vault/audit' }
    ],
    readiness: createCreativeVaultReadinessBoard(snapshot)
  };
}

export function createCreativeVaultRouteSummary(snapshot = buildCreativeVaultSnapshot()) {
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

