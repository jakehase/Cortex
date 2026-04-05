import { createLocalizationCockpitWorkspace, summarizeLocalizationCockpitWorkspace, createLocalizationCockpitNarratives, createLocalizationCockpitCoverageGrid } from './domain-localization-cockpit.mjs';
import { createLocalizationCockpitPolicies, validateLocalizationCockpitPolicies, summarizeLocalizationCockpitPolicies, createLocalizationCockpitEscalationDeck } from './policies-localization-cockpit.mjs';
import { createLocalizationCockpitAnalyticsTimeline, createLocalizationCockpitForecastEnvelope, createLocalizationCockpitExceptionLedger, summarizeLocalizationCockpitAnalytics } from './analytics-localization-cockpit.mjs';
import { createLocalizationCockpitOperationsBoard, createLocalizationCockpitShiftChecklist, createLocalizationCockpitIncidentDeck } from './operations-localization-cockpit.mjs';
import { createLocalizationCockpitReportCards, createLocalizationCockpitReviewPackets, summarizeLocalizationCockpitReporting } from './reporting-localization-cockpit.mjs';
import { createLocalizationCockpitAuditTrail, createLocalizationCockpitEvidenceManifest, createLocalizationCockpitReadinessAttestation } from './audit-localization-cockpit.mjs';
import { createLocalizationCockpitPlaybooks, createLocalizationCockpitDecisionDeck, createLocalizationCockpitEscalationMoments } from './playbooks-localization-cockpit.mjs';

export function buildLocalizationCockpitSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationCockpitWorkspace(workspaceName);
  const policies = createLocalizationCockpitPolicies();
  return {
    workspace,
    summary: summarizeLocalizationCockpitWorkspace(workspace),
    narratives: createLocalizationCockpitNarratives(workspace),
    coverage: createLocalizationCockpitCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationCockpitPolicies(policies),
    validation: validateLocalizationCockpitPolicies(policies),
    escalationDeck: createLocalizationCockpitEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationCockpitAnalyticsTimeline(),
      forecast: createLocalizationCockpitForecastEnvelope(),
      exceptions: createLocalizationCockpitExceptionLedger(),
      summary: summarizeLocalizationCockpitAnalytics()
    },
    operations: {
      board: createLocalizationCockpitOperationsBoard(),
      checklist: createLocalizationCockpitShiftChecklist(),
      incidents: createLocalizationCockpitIncidentDeck()
    },
    reporting: {
      cards: createLocalizationCockpitReportCards(),
      packets: createLocalizationCockpitReviewPackets(),
      summary: summarizeLocalizationCockpitReporting()
    },
    audit: {
      trail: createLocalizationCockpitAuditTrail(),
      manifest: createLocalizationCockpitEvidenceManifest(),
      attestation: createLocalizationCockpitReadinessAttestation()
    },
    playbooks: createLocalizationCockpitPlaybooks(),
    decisions: createLocalizationCockpitDecisionDeck(),
    escalationMoments: createLocalizationCockpitEscalationMoments()
  };
}

export function createLocalizationCockpitReadinessBoard(snapshot = buildLocalizationCockpitSnapshot()) {
  return [
    { id: 'localization-cockpit-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-cockpit-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-cockpit-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-cockpit-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationCockpitApiDocument(snapshot = buildLocalizationCockpitSnapshot()) {
  return {
    id: 'localization-cockpit-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-cockpit/overview' },
      { method: 'GET', path: '/api/localization-cockpit/reporting' },
      { method: 'POST', path: '/api/localization-cockpit/validate' },
      { method: 'GET', path: '/api/localization-cockpit/audit' }
    ],
    readiness: createLocalizationCockpitReadinessBoard(snapshot)
  };
}

export function createLocalizationCockpitRouteSummary(snapshot = buildLocalizationCockpitSnapshot()) {
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

