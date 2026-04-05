import { createAttributionNavigatorWorkspace, summarizeAttributionNavigatorWorkspace, createAttributionNavigatorNarratives, createAttributionNavigatorCoverageGrid } from './domain-attribution-navigator.mjs';
import { createAttributionNavigatorPolicies, validateAttributionNavigatorPolicies, summarizeAttributionNavigatorPolicies, createAttributionNavigatorEscalationDeck } from './policies-attribution-navigator.mjs';
import { createAttributionNavigatorAnalyticsTimeline, createAttributionNavigatorForecastEnvelope, createAttributionNavigatorExceptionLedger, summarizeAttributionNavigatorAnalytics } from './analytics-attribution-navigator.mjs';
import { createAttributionNavigatorOperationsBoard, createAttributionNavigatorShiftChecklist, createAttributionNavigatorIncidentDeck } from './operations-attribution-navigator.mjs';
import { createAttributionNavigatorReportCards, createAttributionNavigatorReviewPackets, summarizeAttributionNavigatorReporting } from './reporting-attribution-navigator.mjs';
import { createAttributionNavigatorAuditTrail, createAttributionNavigatorEvidenceManifest, createAttributionNavigatorReadinessAttestation } from './audit-attribution-navigator.mjs';
import { createAttributionNavigatorPlaybooks, createAttributionNavigatorDecisionDeck, createAttributionNavigatorEscalationMoments } from './playbooks-attribution-navigator.mjs';

export function buildAttributionNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAttributionNavigatorWorkspace(workspaceName);
  const policies = createAttributionNavigatorPolicies();
  return {
    workspace,
    summary: summarizeAttributionNavigatorWorkspace(workspace),
    narratives: createAttributionNavigatorNarratives(workspace),
    coverage: createAttributionNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeAttributionNavigatorPolicies(policies),
    validation: validateAttributionNavigatorPolicies(policies),
    escalationDeck: createAttributionNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createAttributionNavigatorAnalyticsTimeline(),
      forecast: createAttributionNavigatorForecastEnvelope(),
      exceptions: createAttributionNavigatorExceptionLedger(),
      summary: summarizeAttributionNavigatorAnalytics()
    },
    operations: {
      board: createAttributionNavigatorOperationsBoard(),
      checklist: createAttributionNavigatorShiftChecklist(),
      incidents: createAttributionNavigatorIncidentDeck()
    },
    reporting: {
      cards: createAttributionNavigatorReportCards(),
      packets: createAttributionNavigatorReviewPackets(),
      summary: summarizeAttributionNavigatorReporting()
    },
    audit: {
      trail: createAttributionNavigatorAuditTrail(),
      manifest: createAttributionNavigatorEvidenceManifest(),
      attestation: createAttributionNavigatorReadinessAttestation()
    },
    playbooks: createAttributionNavigatorPlaybooks(),
    decisions: createAttributionNavigatorDecisionDeck(),
    escalationMoments: createAttributionNavigatorEscalationMoments()
  };
}

export function createAttributionNavigatorReadinessBoard(snapshot = buildAttributionNavigatorSnapshot()) {
  return [
    { id: 'attribution-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'attribution-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'attribution-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'attribution-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAttributionNavigatorApiDocument(snapshot = buildAttributionNavigatorSnapshot()) {
  return {
    id: 'attribution-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/attribution-navigator/overview' },
      { method: 'GET', path: '/api/attribution-navigator/reporting' },
      { method: 'POST', path: '/api/attribution-navigator/validate' },
      { method: 'GET', path: '/api/attribution-navigator/audit' }
    ],
    readiness: createAttributionNavigatorReadinessBoard(snapshot)
  };
}

export function createAttributionNavigatorRouteSummary(snapshot = buildAttributionNavigatorSnapshot()) {
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

