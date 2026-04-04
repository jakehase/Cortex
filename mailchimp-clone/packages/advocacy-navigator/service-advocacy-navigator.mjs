import { createAdvocacyNavigatorWorkspace, summarizeAdvocacyNavigatorWorkspace, createAdvocacyNavigatorNarratives, createAdvocacyNavigatorCoverageGrid } from './domain-advocacy-navigator.mjs';
import { createAdvocacyNavigatorPolicies, validateAdvocacyNavigatorPolicies, summarizeAdvocacyNavigatorPolicies, createAdvocacyNavigatorEscalationDeck } from './policies-advocacy-navigator.mjs';
import { createAdvocacyNavigatorAnalyticsTimeline, createAdvocacyNavigatorForecastEnvelope, createAdvocacyNavigatorExceptionLedger, summarizeAdvocacyNavigatorAnalytics } from './analytics-advocacy-navigator.mjs';
import { createAdvocacyNavigatorOperationsBoard, createAdvocacyNavigatorShiftChecklist, createAdvocacyNavigatorIncidentDeck } from './operations-advocacy-navigator.mjs';
import { createAdvocacyNavigatorReportCards, createAdvocacyNavigatorReviewPackets, summarizeAdvocacyNavigatorReporting } from './reporting-advocacy-navigator.mjs';
import { createAdvocacyNavigatorAuditTrail, createAdvocacyNavigatorEvidenceManifest, createAdvocacyNavigatorReadinessAttestation } from './audit-advocacy-navigator.mjs';
import { createAdvocacyNavigatorPlaybooks, createAdvocacyNavigatorDecisionDeck, createAdvocacyNavigatorEscalationMoments } from './playbooks-advocacy-navigator.mjs';

export function buildAdvocacyNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAdvocacyNavigatorWorkspace(workspaceName);
  const policies = createAdvocacyNavigatorPolicies();
  return {
    workspace,
    summary: summarizeAdvocacyNavigatorWorkspace(workspace),
    narratives: createAdvocacyNavigatorNarratives(workspace),
    coverage: createAdvocacyNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeAdvocacyNavigatorPolicies(policies),
    validation: validateAdvocacyNavigatorPolicies(policies),
    escalationDeck: createAdvocacyNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createAdvocacyNavigatorAnalyticsTimeline(),
      forecast: createAdvocacyNavigatorForecastEnvelope(),
      exceptions: createAdvocacyNavigatorExceptionLedger(),
      summary: summarizeAdvocacyNavigatorAnalytics()
    },
    operations: {
      board: createAdvocacyNavigatorOperationsBoard(),
      checklist: createAdvocacyNavigatorShiftChecklist(),
      incidents: createAdvocacyNavigatorIncidentDeck()
    },
    reporting: {
      cards: createAdvocacyNavigatorReportCards(),
      packets: createAdvocacyNavigatorReviewPackets(),
      summary: summarizeAdvocacyNavigatorReporting()
    },
    audit: {
      trail: createAdvocacyNavigatorAuditTrail(),
      manifest: createAdvocacyNavigatorEvidenceManifest(),
      attestation: createAdvocacyNavigatorReadinessAttestation()
    },
    playbooks: createAdvocacyNavigatorPlaybooks(),
    decisions: createAdvocacyNavigatorDecisionDeck(),
    escalationMoments: createAdvocacyNavigatorEscalationMoments()
  };
}

export function createAdvocacyNavigatorReadinessBoard(snapshot = buildAdvocacyNavigatorSnapshot()) {
  return [
    { id: 'advocacy-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'advocacy-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'advocacy-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'advocacy-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAdvocacyNavigatorApiDocument(snapshot = buildAdvocacyNavigatorSnapshot()) {
  return {
    id: 'advocacy-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/advocacy-navigator/overview' },
      { method: 'GET', path: '/api/advocacy-navigator/reporting' },
      { method: 'POST', path: '/api/advocacy-navigator/validate' },
      { method: 'GET', path: '/api/advocacy-navigator/audit' }
    ],
    readiness: createAdvocacyNavigatorReadinessBoard(snapshot)
  };
}

export function createAdvocacyNavigatorRouteSummary(snapshot = buildAdvocacyNavigatorSnapshot()) {
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

