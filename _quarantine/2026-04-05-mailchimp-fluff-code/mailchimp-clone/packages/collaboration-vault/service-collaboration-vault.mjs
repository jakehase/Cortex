import { createCollaborationVaultWorkspace, summarizeCollaborationVaultWorkspace, createCollaborationVaultNarratives, createCollaborationVaultCoverageGrid } from './domain-collaboration-vault.mjs';
import { createCollaborationVaultPolicies, validateCollaborationVaultPolicies, summarizeCollaborationVaultPolicies, createCollaborationVaultEscalationDeck } from './policies-collaboration-vault.mjs';
import { createCollaborationVaultAnalyticsTimeline, createCollaborationVaultForecastEnvelope, createCollaborationVaultExceptionLedger, summarizeCollaborationVaultAnalytics } from './analytics-collaboration-vault.mjs';
import { createCollaborationVaultOperationsBoard, createCollaborationVaultShiftChecklist, createCollaborationVaultIncidentDeck } from './operations-collaboration-vault.mjs';
import { createCollaborationVaultReportCards, createCollaborationVaultReviewPackets, summarizeCollaborationVaultReporting } from './reporting-collaboration-vault.mjs';
import { createCollaborationVaultAuditTrail, createCollaborationVaultEvidenceManifest, createCollaborationVaultReadinessAttestation } from './audit-collaboration-vault.mjs';
import { createCollaborationVaultPlaybooks, createCollaborationVaultDecisionDeck, createCollaborationVaultEscalationMoments } from './playbooks-collaboration-vault.mjs';

export function buildCollaborationVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCollaborationVaultWorkspace(workspaceName);
  const policies = createCollaborationVaultPolicies();
  return {
    workspace,
    summary: summarizeCollaborationVaultWorkspace(workspace),
    narratives: createCollaborationVaultNarratives(workspace),
    coverage: createCollaborationVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeCollaborationVaultPolicies(policies),
    validation: validateCollaborationVaultPolicies(policies),
    escalationDeck: createCollaborationVaultEscalationDeck(policies),
    analytics: {
      timeline: createCollaborationVaultAnalyticsTimeline(),
      forecast: createCollaborationVaultForecastEnvelope(),
      exceptions: createCollaborationVaultExceptionLedger(),
      summary: summarizeCollaborationVaultAnalytics()
    },
    operations: {
      board: createCollaborationVaultOperationsBoard(),
      checklist: createCollaborationVaultShiftChecklist(),
      incidents: createCollaborationVaultIncidentDeck()
    },
    reporting: {
      cards: createCollaborationVaultReportCards(),
      packets: createCollaborationVaultReviewPackets(),
      summary: summarizeCollaborationVaultReporting()
    },
    audit: {
      trail: createCollaborationVaultAuditTrail(),
      manifest: createCollaborationVaultEvidenceManifest(),
      attestation: createCollaborationVaultReadinessAttestation()
    },
    playbooks: createCollaborationVaultPlaybooks(),
    decisions: createCollaborationVaultDecisionDeck(),
    escalationMoments: createCollaborationVaultEscalationMoments()
  };
}

export function createCollaborationVaultReadinessBoard(snapshot = buildCollaborationVaultSnapshot()) {
  return [
    { id: 'collaboration-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'collaboration-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'collaboration-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'collaboration-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCollaborationVaultApiDocument(snapshot = buildCollaborationVaultSnapshot()) {
  return {
    id: 'collaboration-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/collaboration-vault/overview' },
      { method: 'GET', path: '/api/collaboration-vault/reporting' },
      { method: 'POST', path: '/api/collaboration-vault/validate' },
      { method: 'GET', path: '/api/collaboration-vault/audit' }
    ],
    readiness: createCollaborationVaultReadinessBoard(snapshot)
  };
}

export function createCollaborationVaultRouteSummary(snapshot = buildCollaborationVaultSnapshot()) {
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

