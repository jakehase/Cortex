import { createLocalizationNavigatorWorkspace, summarizeLocalizationNavigatorWorkspace, createLocalizationNavigatorNarratives, createLocalizationNavigatorCoverageGrid } from './domain-localization-navigator.mjs';
import { createLocalizationNavigatorPolicies, validateLocalizationNavigatorPolicies, summarizeLocalizationNavigatorPolicies, createLocalizationNavigatorEscalationDeck } from './policies-localization-navigator.mjs';
import { createLocalizationNavigatorAnalyticsTimeline, createLocalizationNavigatorForecastEnvelope, createLocalizationNavigatorExceptionLedger, summarizeLocalizationNavigatorAnalytics } from './analytics-localization-navigator.mjs';
import { createLocalizationNavigatorOperationsBoard, createLocalizationNavigatorShiftChecklist, createLocalizationNavigatorIncidentDeck } from './operations-localization-navigator.mjs';
import { createLocalizationNavigatorReportCards, createLocalizationNavigatorReviewPackets, summarizeLocalizationNavigatorReporting } from './reporting-localization-navigator.mjs';
import { createLocalizationNavigatorAuditTrail, createLocalizationNavigatorEvidenceManifest, createLocalizationNavigatorReadinessAttestation } from './audit-localization-navigator.mjs';
import { createLocalizationNavigatorPlaybooks, createLocalizationNavigatorDecisionDeck, createLocalizationNavigatorEscalationMoments } from './playbooks-localization-navigator.mjs';

export function buildLocalizationNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createLocalizationNavigatorWorkspace(workspaceName);
  const policies = createLocalizationNavigatorPolicies();
  return {
    workspace,
    summary: summarizeLocalizationNavigatorWorkspace(workspace),
    narratives: createLocalizationNavigatorNarratives(workspace),
    coverage: createLocalizationNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeLocalizationNavigatorPolicies(policies),
    validation: validateLocalizationNavigatorPolicies(policies),
    escalationDeck: createLocalizationNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createLocalizationNavigatorAnalyticsTimeline(),
      forecast: createLocalizationNavigatorForecastEnvelope(),
      exceptions: createLocalizationNavigatorExceptionLedger(),
      summary: summarizeLocalizationNavigatorAnalytics()
    },
    operations: {
      board: createLocalizationNavigatorOperationsBoard(),
      checklist: createLocalizationNavigatorShiftChecklist(),
      incidents: createLocalizationNavigatorIncidentDeck()
    },
    reporting: {
      cards: createLocalizationNavigatorReportCards(),
      packets: createLocalizationNavigatorReviewPackets(),
      summary: summarizeLocalizationNavigatorReporting()
    },
    audit: {
      trail: createLocalizationNavigatorAuditTrail(),
      manifest: createLocalizationNavigatorEvidenceManifest(),
      attestation: createLocalizationNavigatorReadinessAttestation()
    },
    playbooks: createLocalizationNavigatorPlaybooks(),
    decisions: createLocalizationNavigatorDecisionDeck(),
    escalationMoments: createLocalizationNavigatorEscalationMoments()
  };
}

export function createLocalizationNavigatorReadinessBoard(snapshot = buildLocalizationNavigatorSnapshot()) {
  return [
    { id: 'localization-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'localization-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'localization-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'localization-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createLocalizationNavigatorApiDocument(snapshot = buildLocalizationNavigatorSnapshot()) {
  return {
    id: 'localization-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/localization-navigator/overview' },
      { method: 'GET', path: '/api/localization-navigator/reporting' },
      { method: 'POST', path: '/api/localization-navigator/validate' },
      { method: 'GET', path: '/api/localization-navigator/audit' }
    ],
    readiness: createLocalizationNavigatorReadinessBoard(snapshot)
  };
}

export function createLocalizationNavigatorRouteSummary(snapshot = buildLocalizationNavigatorSnapshot()) {
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

