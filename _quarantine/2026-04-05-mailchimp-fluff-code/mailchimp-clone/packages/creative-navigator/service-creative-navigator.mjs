import { createCreativeNavigatorWorkspace, summarizeCreativeNavigatorWorkspace, createCreativeNavigatorNarratives, createCreativeNavigatorCoverageGrid } from './domain-creative-navigator.mjs';
import { createCreativeNavigatorPolicies, validateCreativeNavigatorPolicies, summarizeCreativeNavigatorPolicies, createCreativeNavigatorEscalationDeck } from './policies-creative-navigator.mjs';
import { createCreativeNavigatorAnalyticsTimeline, createCreativeNavigatorForecastEnvelope, createCreativeNavigatorExceptionLedger, summarizeCreativeNavigatorAnalytics } from './analytics-creative-navigator.mjs';
import { createCreativeNavigatorOperationsBoard, createCreativeNavigatorShiftChecklist, createCreativeNavigatorIncidentDeck } from './operations-creative-navigator.mjs';
import { createCreativeNavigatorReportCards, createCreativeNavigatorReviewPackets, summarizeCreativeNavigatorReporting } from './reporting-creative-navigator.mjs';
import { createCreativeNavigatorAuditTrail, createCreativeNavigatorEvidenceManifest, createCreativeNavigatorReadinessAttestation } from './audit-creative-navigator.mjs';
import { createCreativeNavigatorPlaybooks, createCreativeNavigatorDecisionDeck, createCreativeNavigatorEscalationMoments } from './playbooks-creative-navigator.mjs';

export function buildCreativeNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createCreativeNavigatorWorkspace(workspaceName);
  const policies = createCreativeNavigatorPolicies();
  return {
    workspace,
    summary: summarizeCreativeNavigatorWorkspace(workspace),
    narratives: createCreativeNavigatorNarratives(workspace),
    coverage: createCreativeNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeCreativeNavigatorPolicies(policies),
    validation: validateCreativeNavigatorPolicies(policies),
    escalationDeck: createCreativeNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createCreativeNavigatorAnalyticsTimeline(),
      forecast: createCreativeNavigatorForecastEnvelope(),
      exceptions: createCreativeNavigatorExceptionLedger(),
      summary: summarizeCreativeNavigatorAnalytics()
    },
    operations: {
      board: createCreativeNavigatorOperationsBoard(),
      checklist: createCreativeNavigatorShiftChecklist(),
      incidents: createCreativeNavigatorIncidentDeck()
    },
    reporting: {
      cards: createCreativeNavigatorReportCards(),
      packets: createCreativeNavigatorReviewPackets(),
      summary: summarizeCreativeNavigatorReporting()
    },
    audit: {
      trail: createCreativeNavigatorAuditTrail(),
      manifest: createCreativeNavigatorEvidenceManifest(),
      attestation: createCreativeNavigatorReadinessAttestation()
    },
    playbooks: createCreativeNavigatorPlaybooks(),
    decisions: createCreativeNavigatorDecisionDeck(),
    escalationMoments: createCreativeNavigatorEscalationMoments()
  };
}

export function createCreativeNavigatorReadinessBoard(snapshot = buildCreativeNavigatorSnapshot()) {
  return [
    { id: 'creative-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'creative-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'creative-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'creative-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createCreativeNavigatorApiDocument(snapshot = buildCreativeNavigatorSnapshot()) {
  return {
    id: 'creative-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/creative-navigator/overview' },
      { method: 'GET', path: '/api/creative-navigator/reporting' },
      { method: 'POST', path: '/api/creative-navigator/validate' },
      { method: 'GET', path: '/api/creative-navigator/audit' }
    ],
    readiness: createCreativeNavigatorReadinessBoard(snapshot)
  };
}

export function createCreativeNavigatorRouteSummary(snapshot = buildCreativeNavigatorSnapshot()) {
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

