import { createAdvocacyVaultWorkspace, summarizeAdvocacyVaultWorkspace, createAdvocacyVaultNarratives, createAdvocacyVaultCoverageGrid } from './domain-advocacy-vault.mjs';
import { createAdvocacyVaultPolicies, validateAdvocacyVaultPolicies, summarizeAdvocacyVaultPolicies, createAdvocacyVaultEscalationDeck } from './policies-advocacy-vault.mjs';
import { createAdvocacyVaultAnalyticsTimeline, createAdvocacyVaultForecastEnvelope, createAdvocacyVaultExceptionLedger, summarizeAdvocacyVaultAnalytics } from './analytics-advocacy-vault.mjs';
import { createAdvocacyVaultOperationsBoard, createAdvocacyVaultShiftChecklist, createAdvocacyVaultIncidentDeck } from './operations-advocacy-vault.mjs';
import { createAdvocacyVaultReportCards, createAdvocacyVaultReviewPackets, summarizeAdvocacyVaultReporting } from './reporting-advocacy-vault.mjs';
import { createAdvocacyVaultAuditTrail, createAdvocacyVaultEvidenceManifest, createAdvocacyVaultReadinessAttestation } from './audit-advocacy-vault.mjs';
import { createAdvocacyVaultPlaybooks, createAdvocacyVaultDecisionDeck, createAdvocacyVaultEscalationMoments } from './playbooks-advocacy-vault.mjs';

export function buildAdvocacyVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyVaultWorkspace(workspaceName);
  const policies = createAdvocacyVaultPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyVaultWorkspace(workspace),
    narratives: createAdvocacyVaultNarratives(workspace),
    coverage: createAdvocacyVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyVaultPolicies(policies),
    validation: validateAdvocacyVaultPolicies(policies),
    escalationDeck: createAdvocacyVaultEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyVaultAnalyticsTimeline(),
      forecast: createAdvocacyVaultForecastEnvelope(),
      exceptions: createAdvocacyVaultExceptionLedger(),
      summary: summarizeAdvocacyVaultAnalytics()
    },
    operations: {
      board: createAdvocacyVaultOperationsBoard(),
      checklist: createAdvocacyVaultShiftChecklist(),
      incidents: createAdvocacyVaultIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyVaultReportCards(),
      packets: createAdvocacyVaultReviewPackets(),
      summary: summarizeAdvocacyVaultReporting()
    },
    audit: {
      trail: createAdvocacyVaultAuditTrail(),
      manifest: createAdvocacyVaultEvidenceManifest(),
      attestation: createAdvocacyVaultReadinessAttestation()
    },
    playbooks: createAdvocacyVaultPlaybooks(),
    decisions: createAdvocacyVaultDecisionDeck(),
    escalationMoments: createAdvocacyVaultEscalationMoments()
  };
}

export function createAdvocacyVaultReadinessBoard(snapshot = buildAdvocacyVaultSnapshot()) {
  return [
    { id: 'advocacy-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyVaultApiDocument(snapshot = buildAdvocacyVaultSnapshot()) {
  return {
    id: 'advocacy-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-vault/overview' },
      { method: 'GET', path: '/api/advocacy-vault/reporting' },
      { method: 'POST', path: '/api/advocacy-vault/validate' },
      { method: 'GET', path: '/api/advocacy-vault/audit' }
    ],
    readiness: createAdvocacyVaultReadinessBoard(snapshot)
  };
}

export function createAdvocacyVaultRouteSummary(snapshot = buildAdvocacyVaultSnapshot()) {
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

