import { createAnalyticsNavigatorWorkspace, summarizeAnalyticsNavigatorWorkspace, createAnalyticsNavigatorNarratives, createAnalyticsNavigatorCoverageGrid } from './domain-analytics-navigator.mjs';
import { createAnalyticsNavigatorPolicies, validateAnalyticsNavigatorPolicies, summarizeAnalyticsNavigatorPolicies, createAnalyticsNavigatorEscalationDeck } from './policies-analytics-navigator.mjs';
import { createAnalyticsNavigatorAnalyticsTimeline, createAnalyticsNavigatorForecastEnvelope, createAnalyticsNavigatorExceptionLedger, summarizeAnalyticsNavigatorAnalytics } from './analytics-analytics-navigator.mjs';
import { createAnalyticsNavigatorOperationsBoard, createAnalyticsNavigatorShiftChecklist, createAnalyticsNavigatorIncidentDeck } from './operations-analytics-navigator.mjs';
import { createAnalyticsNavigatorReportCards, createAnalyticsNavigatorReviewPackets, summarizeAnalyticsNavigatorReporting } from './reporting-analytics-navigator.mjs';
import { createAnalyticsNavigatorAuditTrail, createAnalyticsNavigatorEvidenceManifest, createAnalyticsNavigatorReadinessAttestation } from './audit-analytics-navigator.mjs';
import { createAnalyticsNavigatorPlaybooks, createAnalyticsNavigatorDecisionDeck, createAnalyticsNavigatorEscalationMoments } from './playbooks-analytics-navigator.mjs';

export function buildAnalyticsNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAnalyticsNavigatorWorkspace(workspaceName);
  const policies = createAnalyticsNavigatorPolicies();
  return {
    workspace,
    summary: summarizeAnalyticsNavigatorWorkspace(workspace),
    narratives: createAnalyticsNavigatorNarratives(workspace),
    coverage: createAnalyticsNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeAnalyticsNavigatorPolicies(policies),
    validation: validateAnalyticsNavigatorPolicies(policies),
    escalationDeck: createAnalyticsNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createAnalyticsNavigatorAnalyticsTimeline(),
      forecast: createAnalyticsNavigatorForecastEnvelope(),
      exceptions: createAnalyticsNavigatorExceptionLedger(),
      summary: summarizeAnalyticsNavigatorAnalytics()
    },
    operations: {
      board: createAnalyticsNavigatorOperationsBoard(),
      checklist: createAnalyticsNavigatorShiftChecklist(),
      incidents: createAnalyticsNavigatorIncidentDeck()
    },
    reporting: {
      cards: createAnalyticsNavigatorReportCards(),
      packets: createAnalyticsNavigatorReviewPackets(),
      summary: summarizeAnalyticsNavigatorReporting()
    },
    audit: {
      trail: createAnalyticsNavigatorAuditTrail(),
      manifest: createAnalyticsNavigatorEvidenceManifest(),
      attestation: createAnalyticsNavigatorReadinessAttestation()
    },
    playbooks: createAnalyticsNavigatorPlaybooks(),
    decisions: createAnalyticsNavigatorDecisionDeck(),
    escalationMoments: createAnalyticsNavigatorEscalationMoments()
  };
}

export function createAnalyticsNavigatorReadinessBoard(snapshot = buildAnalyticsNavigatorSnapshot()) {
  return [
    { id: 'analytics-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'analytics-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'analytics-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'analytics-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAnalyticsNavigatorApiDocument(snapshot = buildAnalyticsNavigatorSnapshot()) {
  return {
    id: 'analytics-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/analytics-navigator/overview' },
      { method: 'GET', path: '/api/analytics-navigator/reporting' },
      { method: 'POST', path: '/api/analytics-navigator/validate' },
      { method: 'GET', path: '/api/analytics-navigator/audit' }
    ],
    readiness: createAnalyticsNavigatorReadinessBoard(snapshot)
  };
}

export function createAnalyticsNavigatorRouteSummary(snapshot = buildAnalyticsNavigatorSnapshot()) {
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

