import { createLocalizationVaultWorkspace, summarizeLocalizationVaultWorkspace, createLocalizationVaultNarratives, createLocalizationVaultCoverageGrid } from './domain-localization-vault.mjs';
import { createLocalizationVaultPolicies, validateLocalizationVaultPolicies, summarizeLocalizationVaultPolicies, createLocalizationVaultEscalationDeck } from './policies-localization-vault.mjs';
import { createLocalizationVaultAnalyticsTimeline, createLocalizationVaultForecastEnvelope, createLocalizationVaultExceptionLedger, summarizeLocalizationVaultAnalytics } from './analytics-localization-vault.mjs';
import { createLocalizationVaultOperationsBoard, createLocalizationVaultShiftChecklist, createLocalizationVaultIncidentDeck } from './operations-localization-vault.mjs';
import { createLocalizationVaultReportCards, createLocalizationVaultReviewPackets, summarizeLocalizationVaultReporting } from './reporting-localization-vault.mjs';
import { createLocalizationVaultAuditTrail, createLocalizationVaultEvidenceManifest, createLocalizationVaultReadinessAttestation } from './audit-localization-vault.mjs';
import { createLocalizationVaultPlaybooks, createLocalizationVaultDecisionDeck, createLocalizationVaultEscalationMoments } from './playbooks-localization-vault.mjs';

export function buildLocalizationVaultSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationVaultWorkspace(workspaceName);
  const policies = createLocalizationVaultPolicies();
  return {
    workspace,
    summary: summarizeLocalizationVaultWorkspace(workspace),
    narratives: createLocalizationVaultNarratives(workspace),
    coverage: createLocalizationVaultCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationVaultPolicies(policies),
    validation: validateLocalizationVaultPolicies(policies),
    escalationDeck: createLocalizationVaultEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationVaultAnalyticsTimeline(),
      forecast: createLocalizationVaultForecastEnvelope(),
      exceptions: createLocalizationVaultExceptionLedger(),
      summary: summarizeLocalizationVaultAnalytics()
    },
    operations: {
      board: createLocalizationVaultOperationsBoard(),
      checklist: createLocalizationVaultShiftChecklist(),
      incidents: createLocalizationVaultIncidentDeck()
    },
    reporting: {
      cards: createLocalizationVaultReportCards(),
      packets: createLocalizationVaultReviewPackets(),
      summary: summarizeLocalizationVaultReporting()
    },
    audit: {
      trail: createLocalizationVaultAuditTrail(),
      manifest: createLocalizationVaultEvidenceManifest(),
      attestation: createLocalizationVaultReadinessAttestation()
    },
    playbooks: createLocalizationVaultPlaybooks(),
    decisions: createLocalizationVaultDecisionDeck(),
    escalationMoments: createLocalizationVaultEscalationMoments()
  };
}

export function createLocalizationVaultReadinessBoard(snapshot = buildLocalizationVaultSnapshot()) {
  return [
    { id: 'localization-vault-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-vault-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-vault-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-vault-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationVaultApiDocument(snapshot = buildLocalizationVaultSnapshot()) {
  return {
    id: 'localization-vault-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-vault/overview' },
      { method: 'GET', path: '/api/localization-vault/reporting' },
      { method: 'POST', path: '/api/localization-vault/validate' },
      { method: 'GET', path: '/api/localization-vault/audit' }
    ],
    readiness: createLocalizationVaultReadinessBoard(snapshot)
  };
}

export function createLocalizationVaultRouteSummary(snapshot = buildLocalizationVaultSnapshot()) {
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

