import { createLoyaltyVaultWorkspace, summarizeLoyaltyVaultWorkspace, createLoyaltyVaultNarratives, createLoyaltyVaultCoverageGrid } from './domain-loyalty-vault.mjs';
import { createLoyaltyVaultPolicies, validateLoyaltyVaultPolicies, summarizeLoyaltyVaultPolicies, createLoyaltyVaultEscalationDeck } from './policies-loyalty-vault.mjs';
import { createLoyaltyVaultAnalyticsTimeline, createLoyaltyVaultForecastEnvelope, createLoyaltyVaultExceptionLedger, summarizeLoyaltyVaultAnalytics } from './analytics-loyalty-vault.mjs';
import { createLoyaltyVaultOperationsBoard, createLoyaltyVaultShiftChecklist, createLoyaltyVaultIncidentDeck } from './operations-loyalty-vault.mjs';
import { createLoyaltyVaultReportCards, createLoyaltyVaultReviewPackets, summarizeLoyaltyVaultReporting } from './reporting-loyalty-vault.mjs';
import { createLoyaltyVaultAuditTrail, createLoyaltyVaultEvidenceManifest, createLoyaltyVaultReadinessAttestation } from './audit-loyalty-vault.mjs';
import { createLoyaltyVaultPlaybooks, createLoyaltyVaultDecisionDeck, createLoyaltyVaultEscalationMoments } from './playbooks-loyalty-vault.mjs';

export function buildLoyaltyVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLoyaltyVaultWorkspace(workspaceName);
  const policies = createLoyaltyVaultPolicies();
  return {
    workspace,
    summary: summarizeLoyaltyVaultWorkspace(workspace),
    narratives: createLoyaltyVaultNarratives(workspace),
    coverage: createLoyaltyVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeLoyaltyVaultPolicies(policies),
    validation: validateLoyaltyVaultPolicies(policies),
    escalationDeck: createLoyaltyVaultEscalationDeck(policies),
    analytics: {
      timeline: createLoyaltyVaultAnalyticsTimeline(),
      forecast: createLoyaltyVaultForecastEnvelope(),
      exceptions: createLoyaltyVaultExceptionLedger(),
      summary: summarizeLoyaltyVaultAnalytics()
    },
    operations: {
      board: createLoyaltyVaultOperationsBoard(),
      checklist: createLoyaltyVaultShiftChecklist(),
      incidents: createLoyaltyVaultIncidentDeck()
    },
    reporting: {
      cards: createLoyaltyVaultReportCards(),
      packets: createLoyaltyVaultReviewPackets(),
      summary: summarizeLoyaltyVaultReporting()
    },
    audit: {
      trail: createLoyaltyVaultAuditTrail(),
      manifest: createLoyaltyVaultEvidenceManifest(),
      attestation: createLoyaltyVaultReadinessAttestation()
    },
    playbooks: createLoyaltyVaultPlaybooks(),
    decisions: createLoyaltyVaultDecisionDeck(),
    escalationMoments: createLoyaltyVaultEscalationMoments()
  };
}

export function createLoyaltyVaultReadinessBoard(snapshot = buildLoyaltyVaultSnapshot()) {
  return [
    { id: 'loyalty-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'loyalty-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'loyalty-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'loyalty-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLoyaltyVaultApiDocument(snapshot = buildLoyaltyVaultSnapshot()) {
  return {
    id: 'loyalty-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/loyalty-vault/overview' },
      { method: 'GET', path: '/api/loyalty-vault/reporting' },
      { method: 'POST', path: '/api/loyalty-vault/validate' },
      { method: 'GET', path: '/api/loyalty-vault/audit' }
    ],
    readiness: createLoyaltyVaultReadinessBoard(snapshot)
  };
}

export function createLoyaltyVaultRouteSummary(snapshot = buildLoyaltyVaultSnapshot()) {
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

