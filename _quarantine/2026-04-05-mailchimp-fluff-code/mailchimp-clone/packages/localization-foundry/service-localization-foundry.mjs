import { createLocalizationFoundryWorkspace, summarizeLocalizationFoundryWorkspace, createLocalizationFoundryNarratives, createLocalizationFoundryCoverageGrid } from './domain-localization-foundry.mjs';
import { createLocalizationFoundryPolicies, validateLocalizationFoundryPolicies, summarizeLocalizationFoundryPolicies, createLocalizationFoundryEscalationDeck } from './policies-localization-foundry.mjs';
import { createLocalizationFoundryAnalyticsTimeline, createLocalizationFoundryForecastEnvelope, createLocalizationFoundryExceptionLedger, summarizeLocalizationFoundryAnalytics } from './analytics-localization-foundry.mjs';
import { createLocalizationFoundryOperationsBoard, createLocalizationFoundryShiftChecklist, createLocalizationFoundryIncidentDeck } from './operations-localization-foundry.mjs';
import { createLocalizationFoundryReportCards, createLocalizationFoundryReviewPackets, summarizeLocalizationFoundryReporting } from './reporting-localization-foundry.mjs';
import { createLocalizationFoundryAuditTrail, createLocalizationFoundryEvidenceManifest, createLocalizationFoundryReadinessAttestation } from './audit-localization-foundry.mjs';
import { createLocalizationFoundryPlaybooks, createLocalizationFoundryDecisionDeck, createLocalizationFoundryEscalationMoments } from './playbooks-localization-foundry.mjs';

export function buildLocalizationFoundrySnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationFoundryWorkspace(workspaceName);
  const policies = createLocalizationFoundryPolicies();
  return {
    workspace,
    summary: summarizeLocalizationFoundryWorkspace(workspace),
    narratives: createLocalizationFoundryNarratives(workspace),
    coverage: createLocalizationFoundryCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationFoundryPolicies(policies),
    validation: validateLocalizationFoundryPolicies(policies),
    escalationDeck: createLocalizationFoundryEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationFoundryAnalyticsTimeline(),
      forecast: createLocalizationFoundryForecastEnvelope(),
      exceptions: createLocalizationFoundryExceptionLedger(),
      summary: summarizeLocalizationFoundryAnalytics()
    },
    operations: {
      board: createLocalizationFoundryOperationsBoard(),
      checklist: createLocalizationFoundryShiftChecklist(),
      incidents: createLocalizationFoundryIncidentDeck()
    },
    reporting: {
      cards: createLocalizationFoundryReportCards(),
      packets: createLocalizationFoundryReviewPackets(),
      summary: summarizeLocalizationFoundryReporting()
    },
    audit: {
      trail: createLocalizationFoundryAuditTrail(),
      manifest: createLocalizationFoundryEvidenceManifest(),
      attestation: createLocalizationFoundryReadinessAttestation()
    },
    playbooks: createLocalizationFoundryPlaybooks(),
    decisions: createLocalizationFoundryDecisionDeck(),
    escalationMoments: createLocalizationFoundryEscalationMoments()
  };
}

export function createLocalizationFoundryReadinessBoard(snapshot = buildLocalizationFoundrySnapshot()) {
  return [
    { id: 'localization-foundry-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-foundry-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-foundry-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-foundry-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationFoundryApiDocument(snapshot = buildLocalizationFoundrySnapshot()) {
  return {
    id: 'localization-foundry-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-foundry/overview' },
      { method: 'GET', path: '/api/localization-foundry/reporting' },
      { method: 'POST', path: '/api/localization-foundry/validate' },
      { method: 'GET', path: '/api/localization-foundry/audit' }
    ],
    readiness: createLocalizationFoundryReadinessBoard(snapshot)
  };
}

export function createLocalizationFoundryRouteSummary(snapshot = buildLocalizationFoundrySnapshot()) {
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

