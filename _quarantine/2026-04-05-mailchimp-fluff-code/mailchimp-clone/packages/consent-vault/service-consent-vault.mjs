import { createConsentVaultWorkspace, summarizeConsentVaultWorkspace, createConsentVaultNarratives, createConsentVaultCoverageGrid } from './domain-consent-vault.mjs';
import { createConsentVaultPolicies, validateConsentVaultPolicies, summarizeConsentVaultPolicies, createConsentVaultEscalationDeck } from './policies-consent-vault.mjs';
import { createConsentVaultAnalyticsTimeline, createConsentVaultForecastEnvelope, createConsentVaultExceptionLedger, summarizeConsentVaultAnalytics } from './analytics-consent-vault.mjs';
import { createConsentVaultOperationsBoard, createConsentVaultShiftChecklist, createConsentVaultIncidentDeck } from './operations-consent-vault.mjs';
import { createConsentVaultReportCards, createConsentVaultReviewPackets, summarizeConsentVaultReporting } from './reporting-consent-vault.mjs';
import { createConsentVaultAuditTrail, createConsentVaultEvidenceManifest, createConsentVaultReadinessAttestation } from './audit-consent-vault.mjs';
import { createConsentVaultPlaybooks, createConsentVaultDecisionDeck, createConsentVaultEscalationMoments } from './playbooks-consent-vault.mjs';

export function buildConsentVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createConsentVaultWorkspace(workspaceName);
  const policies = createConsentVaultPolicies();
  return {
    workspace,
    summary: summarizeConsentVaultWorkspace(workspace),
    narratives: createConsentVaultNarratives(workspace),
    coverage: createConsentVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeConsentVaultPolicies(policies),
    validation: validateConsentVaultPolicies(policies),
    escalationDeck: createConsentVaultEscalationDeck(policies),
    analytics: {
      timeline: createConsentVaultAnalyticsTimeline(),
      forecast: createConsentVaultForecastEnvelope(),
      exceptions: createConsentVaultExceptionLedger(),
      summary: summarizeConsentVaultAnalytics()
    },
    operations: {
      board: createConsentVaultOperationsBoard(),
      checklist: createConsentVaultShiftChecklist(),
      incidents: createConsentVaultIncidentDeck()
    },
    reporting: {
      cards: createConsentVaultReportCards(),
      packets: createConsentVaultReviewPackets(),
      summary: summarizeConsentVaultReporting()
    },
    audit: {
      trail: createConsentVaultAuditTrail(),
      manifest: createConsentVaultEvidenceManifest(),
      attestation: createConsentVaultReadinessAttestation()
    },
    playbooks: createConsentVaultPlaybooks(),
    decisions: createConsentVaultDecisionDeck(),
    escalationMoments: createConsentVaultEscalationMoments()
  };
}

export function createConsentVaultReadinessBoard(snapshot = buildConsentVaultSnapshot()) {
  return [
    { id: 'consent-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'consent-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'consent-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'consent-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createConsentVaultApiDocument(snapshot = buildConsentVaultSnapshot()) {
  return {
    id: 'consent-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/consent-vault/overview' },
      { method: 'GET', path: '/api/consent-vault/reporting' },
      { method: 'POST', path: '/api/consent-vault/validate' },
      { method: 'GET', path: '/api/consent-vault/audit' }
    ],
    readiness: createConsentVaultReadinessBoard(snapshot)
  };
}

export function createConsentVaultRouteSummary(snapshot = buildConsentVaultSnapshot()) {
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

