import { createContentNavigatorWorkspace, summarizeContentNavigatorWorkspace, createContentNavigatorNarratives, createContentNavigatorCoverageGrid } from './domain-content-navigator.mjs';
import { createContentNavigatorPolicies, validateContentNavigatorPolicies, summarizeContentNavigatorPolicies, createContentNavigatorEscalationDeck } from './policies-content-navigator.mjs';
import { createContentNavigatorAnalyticsTimeline, createContentNavigatorForecastEnvelope, createContentNavigatorExceptionLedger, summarizeContentNavigatorAnalytics } from './analytics-content-navigator.mjs';
import { createContentNavigatorOperationsBoard, createContentNavigatorShiftChecklist, createContentNavigatorIncidentDeck } from './operations-content-navigator.mjs';
import { createContentNavigatorReportCards, createContentNavigatorReviewPackets, summarizeContentNavigatorReporting } from './reporting-content-navigator.mjs';
import { createContentNavigatorAuditTrail, createContentNavigatorEvidenceManifest, createContentNavigatorReadinessAttestation } from './audit-content-navigator.mjs';
import { createContentNavigatorPlaybooks, createContentNavigatorDecisionDeck, createContentNavigatorEscalationMoments } from './playbooks-content-navigator.mjs';

export function buildContentNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createContentNavigatorWorkspace(workspaceName);
  const policies = createContentNavigatorPolicies();
  return {
    workspace,
    summary: summarizeContentNavigatorWorkspace(workspace),
    narratives: createContentNavigatorNarratives(workspace),
    coverage: createContentNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeContentNavigatorPolicies(policies),
    validation: validateContentNavigatorPolicies(policies),
    escalationDeck: createContentNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createContentNavigatorAnalyticsTimeline(),
      forecast: createContentNavigatorForecastEnvelope(),
      exceptions: createContentNavigatorExceptionLedger(),
      summary: summarizeContentNavigatorAnalytics()
    },
    operations: {
      board: createContentNavigatorOperationsBoard(),
      checklist: createContentNavigatorShiftChecklist(),
      incidents: createContentNavigatorIncidentDeck()
    },
    reporting: {
      cards: createContentNavigatorReportCards(),
      packets: createContentNavigatorReviewPackets(),
      summary: summarizeContentNavigatorReporting()
    },
    audit: {
      trail: createContentNavigatorAuditTrail(),
      manifest: createContentNavigatorEvidenceManifest(),
      attestation: createContentNavigatorReadinessAttestation()
    },
    playbooks: createContentNavigatorPlaybooks(),
    decisions: createContentNavigatorDecisionDeck(),
    escalationMoments: createContentNavigatorEscalationMoments()
  };
}

export function createContentNavigatorReadinessBoard(snapshot = buildContentNavigatorSnapshot()) {
  return [
    { id: 'content-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'content-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'content-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'content-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createContentNavigatorApiDocument(snapshot = buildContentNavigatorSnapshot()) {
  return {
    id: 'content-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/content-navigator/overview' },
      { method: 'GET', path: '/api/content-navigator/reporting' },
      { method: 'POST', path: '/api/content-navigator/validate' },
      { method: 'GET', path: '/api/content-navigator/audit' }
    ],
    readiness: createContentNavigatorReadinessBoard(snapshot)
  };
}

export function createContentNavigatorRouteSummary(snapshot = buildContentNavigatorSnapshot()) {
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

