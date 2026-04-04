import { createAudienceVaultWorkspace, summarizeAudienceVaultWorkspace, createAudienceVaultNarratives, createAudienceVaultCoverageGrid } from './domain-audience-vault.mjs';
import { createAudienceVaultPolicies, validateAudienceVaultPolicies, summarizeAudienceVaultPolicies, createAudienceVaultEscalationDeck } from './policies-audience-vault.mjs';
import { createAudienceVaultAnalyticsTimeline, createAudienceVaultForecastEnvelope, createAudienceVaultExceptionLedger, summarizeAudienceVaultAnalytics } from './analytics-audience-vault.mjs';
import { createAudienceVaultOperationsBoard, createAudienceVaultShiftChecklist, createAudienceVaultIncidentDeck } from './operations-audience-vault.mjs';
import { createAudienceVaultReportCards, createAudienceVaultReviewPackets, summarizeAudienceVaultReporting } from './reporting-audience-vault.mjs';
import { createAudienceVaultAuditTrail, createAudienceVaultEvidenceManifest, createAudienceVaultReadinessAttestation } from './audit-audience-vault.mjs';
import { createAudienceVaultPlaybooks, createAudienceVaultDecisionDeck, createAudienceVaultEscalationMoments } from './playbooks-audience-vault.mjs';

export function buildAudienceVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAudienceVaultWorkspace(workspaceName);
  const policies = createAudienceVaultPolicies();
  return {
    workspace,
    summary: summarizeAudienceVaultWorkspace(workspace),
    narratives: createAudienceVaultNarratives(workspace),
    coverage: createAudienceVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeAudienceVaultPolicies(policies),
    validation: validateAudienceVaultPolicies(policies),
    escalationDeck: createAudienceVaultEscalationDeck(policies),
    analytics: {
      timeline: createAudienceVaultAnalyticsTimeline(),
      forecast: createAudienceVaultForecastEnvelope(),
      exceptions: createAudienceVaultExceptionLedger(),
      summary: summarizeAudienceVaultAnalytics()
    },
    operations: {
      board: createAudienceVaultOperationsBoard(),
      checklist: createAudienceVaultShiftChecklist(),
      incidents: createAudienceVaultIncidentDeck()
    },
    reporting: {
      cards: createAudienceVaultReportCards(),
      packets: createAudienceVaultReviewPackets(),
      summary: summarizeAudienceVaultReporting()
    },
    audit: {
      trail: createAudienceVaultAuditTrail(),
      manifest: createAudienceVaultEvidenceManifest(),
      attestation: createAudienceVaultReadinessAttestation()
    },
    playbooks: createAudienceVaultPlaybooks(),
    decisions: createAudienceVaultDecisionDeck(),
    escalationMoments: createAudienceVaultEscalationMoments()
  };
}

export function createAudienceVaultReadinessBoard(snapshot = buildAudienceVaultSnapshot()) {
  return [
    { id: 'audience-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'audience-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'audience-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'audience-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAudienceVaultApiDocument(snapshot = buildAudienceVaultSnapshot()) {
  return {
    id: 'audience-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/audience-vault/overview' },
      { method: 'GET', path: '/api/audience-vault/reporting' },
      { method: 'POST', path: '/api/audience-vault/validate' },
      { method: 'GET', path: '/api/audience-vault/audit' }
    ],
    readiness: createAudienceVaultReadinessBoard(snapshot)
  };
}

export function createAudienceVaultRouteSummary(snapshot = buildAudienceVaultSnapshot()) {
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

