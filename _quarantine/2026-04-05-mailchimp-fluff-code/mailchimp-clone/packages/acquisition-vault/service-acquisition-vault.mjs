import { createAcquisitionVaultWorkspace, summarizeAcquisitionVaultWorkspace, createAcquisitionVaultNarratives, createAcquisitionVaultCoverageGrid } from './domain-acquisition-vault.mjs';
import { createAcquisitionVaultPolicies, validateAcquisitionVaultPolicies, summarizeAcquisitionVaultPolicies, createAcquisitionVaultEscalationDeck } from './policies-acquisition-vault.mjs';
import { createAcquisitionVaultAnalyticsTimeline, createAcquisitionVaultForecastEnvelope, createAcquisitionVaultExceptionLedger, summarizeAcquisitionVaultAnalytics } from './analytics-acquisition-vault.mjs';
import { createAcquisitionVaultOperationsBoard, createAcquisitionVaultShiftChecklist, createAcquisitionVaultIncidentDeck } from './operations-acquisition-vault.mjs';
import { createAcquisitionVaultReportCards, createAcquisitionVaultReviewPackets, summarizeAcquisitionVaultReporting } from './reporting-acquisition-vault.mjs';
import { createAcquisitionVaultAuditTrail, createAcquisitionVaultEvidenceManifest, createAcquisitionVaultReadinessAttestation } from './audit-acquisition-vault.mjs';
import { createAcquisitionVaultPlaybooks, createAcquisitionVaultDecisionDeck, createAcquisitionVaultEscalationMoments } from './playbooks-acquisition-vault.mjs';

export function buildAcquisitionVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionVaultWorkspace(workspaceName);
  const policies = createAcquisitionVaultPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionVaultWorkspace(workspace),
    narratives: createAcquisitionVaultNarratives(workspace),
    coverage: createAcquisitionVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionVaultPolicies(policies),
    validation: validateAcquisitionVaultPolicies(policies),
    escalationDeck: createAcquisitionVaultEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionVaultAnalyticsTimeline(),
      forecast: createAcquisitionVaultForecastEnvelope(),
      exceptions: createAcquisitionVaultExceptionLedger(),
      summary: summarizeAcquisitionVaultAnalytics()
    },
    operations: {
      board: createAcquisitionVaultOperationsBoard(),
      checklist: createAcquisitionVaultShiftChecklist(),
      incidents: createAcquisitionVaultIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionVaultReportCards(),
      packets: createAcquisitionVaultReviewPackets(),
      summary: summarizeAcquisitionVaultReporting()
    },
    audit: {
      trail: createAcquisitionVaultAuditTrail(),
      manifest: createAcquisitionVaultEvidenceManifest(),
      attestation: createAcquisitionVaultReadinessAttestation()
    },
    playbooks: createAcquisitionVaultPlaybooks(),
    decisions: createAcquisitionVaultDecisionDeck(),
    escalationMoments: createAcquisitionVaultEscalationMoments()
  };
}

export function createAcquisitionVaultReadinessBoard(snapshot = buildAcquisitionVaultSnapshot()) {
  return [
    { id: 'acquisition-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionVaultApiDocument(snapshot = buildAcquisitionVaultSnapshot()) {
  return {
    id: 'acquisition-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-vault/overview' },
      { method: 'GET', path: '/api/acquisition-vault/reporting' },
      { method: 'POST', path: '/api/acquisition-vault/validate' },
      { method: 'GET', path: '/api/acquisition-vault/audit' }
    ],
    readiness: createAcquisitionVaultReadinessBoard(snapshot)
  };
}

export function createAcquisitionVaultRouteSummary(snapshot = buildAcquisitionVaultSnapshot()) {
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

