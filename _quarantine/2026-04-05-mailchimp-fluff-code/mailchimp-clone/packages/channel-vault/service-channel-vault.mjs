import { createChannelVaultWorkspace, summarizeChannelVaultWorkspace, createChannelVaultNarratives, createChannelVaultCoverageGrid } from './domain-channel-vault.mjs';
import { createChannelVaultPolicies, validateChannelVaultPolicies, summarizeChannelVaultPolicies, createChannelVaultEscalationDeck } from './policies-channel-vault.mjs';
import { createChannelVaultAnalyticsTimeline, createChannelVaultForecastEnvelope, createChannelVaultExceptionLedger, summarizeChannelVaultAnalytics } from './analytics-channel-vault.mjs';
import { createChannelVaultOperationsBoard, createChannelVaultShiftChecklist, createChannelVaultIncidentDeck } from './operations-channel-vault.mjs';
import { createChannelVaultReportCards, createChannelVaultReviewPackets, summarizeChannelVaultReporting } from './reporting-channel-vault.mjs';
import { createChannelVaultAuditTrail, createChannelVaultEvidenceManifest, createChannelVaultReadinessAttestation } from './audit-channel-vault.mjs';
import { createChannelVaultPlaybooks, createChannelVaultDecisionDeck, createChannelVaultEscalationMoments } from './playbooks-channel-vault.mjs';

export function buildChannelVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelVaultWorkspace(workspaceName);
  const policies = createChannelVaultPolicies();
  return {
    workspace,
    summary: summarizeChannelVaultWorkspace(workspace),
    narratives: createChannelVaultNarratives(workspace),
    coverage: createChannelVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelVaultPolicies(policies),
    validation: validateChannelVaultPolicies(policies),
    escalationDeck: createChannelVaultEscalationDeck(policies),
    analytics: {
      timeline: createChannelVaultAnalyticsTimeline(),
      forecast: createChannelVaultForecastEnvelope(),
      exceptions: createChannelVaultExceptionLedger(),
      summary: summarizeChannelVaultAnalytics()
    },
    operations: {
      board: createChannelVaultOperationsBoard(),
      checklist: createChannelVaultShiftChecklist(),
      incidents: createChannelVaultIncidentDeck()
    },
    reporting: {
      cards: createChannelVaultReportCards(),
      packets: createChannelVaultReviewPackets(),
      summary: summarizeChannelVaultReporting()
    },
    audit: {
      trail: createChannelVaultAuditTrail(),
      manifest: createChannelVaultEvidenceManifest(),
      attestation: createChannelVaultReadinessAttestation()
    },
    playbooks: createChannelVaultPlaybooks(),
    decisions: createChannelVaultDecisionDeck(),
    escalationMoments: createChannelVaultEscalationMoments()
  };
}

export function createChannelVaultReadinessBoard(snapshot = buildChannelVaultSnapshot()) {
  return [
    { id: 'channel-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelVaultApiDocument(snapshot = buildChannelVaultSnapshot()) {
  return {
    id: 'channel-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-vault/overview' },
      { method: 'GET', path: '/api/channel-vault/reporting' },
      { method: 'POST', path: '/api/channel-vault/validate' },
      { method: 'GET', path: '/api/channel-vault/audit' }
    ],
    readiness: createChannelVaultReadinessBoard(snapshot)
  };
}

export function createChannelVaultRouteSummary(snapshot = buildChannelVaultSnapshot()) {
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

