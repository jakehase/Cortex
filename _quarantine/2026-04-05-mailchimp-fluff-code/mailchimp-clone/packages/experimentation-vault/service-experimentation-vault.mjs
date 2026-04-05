import { createExperimentationVaultWorkspace, summarizeExperimentationVaultWorkspace, createExperimentationVaultNarratives, createExperimentationVaultCoverageGrid } from './domain-experimentation-vault.mjs';
import { createExperimentationVaultPolicies, validateExperimentationVaultPolicies, summarizeExperimentationVaultPolicies, createExperimentationVaultEscalationDeck } from './policies-experimentation-vault.mjs';
import { createExperimentationVaultAnalyticsTimeline, createExperimentationVaultForecastEnvelope, createExperimentationVaultExceptionLedger, summarizeExperimentationVaultAnalytics } from './analytics-experimentation-vault.mjs';
import { createExperimentationVaultOperationsBoard, createExperimentationVaultShiftChecklist, createExperimentationVaultIncidentDeck } from './operations-experimentation-vault.mjs';
import { createExperimentationVaultReportCards, createExperimentationVaultReviewPackets, summarizeExperimentationVaultReporting } from './reporting-experimentation-vault.mjs';
import { createExperimentationVaultAuditTrail, createExperimentationVaultEvidenceManifest, createExperimentationVaultReadinessAttestation } from './audit-experimentation-vault.mjs';
import { createExperimentationVaultPlaybooks, createExperimentationVaultDecisionDeck, createExperimentationVaultEscalationMoments } from './playbooks-experimentation-vault.mjs';

export function buildExperimentationVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createExperimentationVaultWorkspace(workspaceName);
  const policies = createExperimentationVaultPolicies();
  return {
    workspace,
    summary: summarizeExperimentationVaultWorkspace(workspace),
    narratives: createExperimentationVaultNarratives(workspace),
    coverage: createExperimentationVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeExperimentationVaultPolicies(policies),
    validation: validateExperimentationVaultPolicies(policies),
    escalationDeck: createExperimentationVaultEscalationDeck(policies),
    analytics: {
      timeline: createExperimentationVaultAnalyticsTimeline(),
      forecast: createExperimentationVaultForecastEnvelope(),
      exceptions: createExperimentationVaultExceptionLedger(),
      summary: summarizeExperimentationVaultAnalytics()
    },
    operations: {
      board: createExperimentationVaultOperationsBoard(),
      checklist: createExperimentationVaultShiftChecklist(),
      incidents: createExperimentationVaultIncidentDeck()
    },
    reporting: {
      cards: createExperimentationVaultReportCards(),
      packets: createExperimentationVaultReviewPackets(),
      summary: summarizeExperimentationVaultReporting()
    },
    audit: {
      trail: createExperimentationVaultAuditTrail(),
      manifest: createExperimentationVaultEvidenceManifest(),
      attestation: createExperimentationVaultReadinessAttestation()
    },
    playbooks: createExperimentationVaultPlaybooks(),
    decisions: createExperimentationVaultDecisionDeck(),
    escalationMoments: createExperimentationVaultEscalationMoments()
  };
}

export function createExperimentationVaultReadinessBoard(snapshot = buildExperimentationVaultSnapshot()) {
  return [
    { id: 'experimentation-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'experimentation-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'experimentation-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'experimentation-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createExperimentationVaultApiDocument(snapshot = buildExperimentationVaultSnapshot()) {
  return {
    id: 'experimentation-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/experimentation-vault/overview' },
      { method: 'GET', path: '/api/experimentation-vault/reporting' },
      { method: 'POST', path: '/api/experimentation-vault/validate' },
      { method: 'GET', path: '/api/experimentation-vault/audit' }
    ],
    readiness: createExperimentationVaultReadinessBoard(snapshot)
  };
}

export function createExperimentationVaultRouteSummary(snapshot = buildExperimentationVaultSnapshot()) {
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

