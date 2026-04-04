import { createAcquisitionNavigatorWorkspace, summarizeAcquisitionNavigatorWorkspace, createAcquisitionNavigatorNarratives, createAcquisitionNavigatorCoverageGrid } from './domain-acquisition-navigator.mjs';
import { createAcquisitionNavigatorPolicies, validateAcquisitionNavigatorPolicies, summarizeAcquisitionNavigatorPolicies, createAcquisitionNavigatorEscalationDeck } from './policies-acquisition-navigator.mjs';
import { createAcquisitionNavigatorAnalyticsTimeline, createAcquisitionNavigatorForecastEnvelope, createAcquisitionNavigatorExceptionLedger, summarizeAcquisitionNavigatorAnalytics } from './analytics-acquisition-navigator.mjs';
import { createAcquisitionNavigatorOperationsBoard, createAcquisitionNavigatorShiftChecklist, createAcquisitionNavigatorIncidentDeck } from './operations-acquisition-navigator.mjs';
import { createAcquisitionNavigatorReportCards, createAcquisitionNavigatorReviewPackets, summarizeAcquisitionNavigatorReporting } from './reporting-acquisition-navigator.mjs';
import { createAcquisitionNavigatorAuditTrail, createAcquisitionNavigatorEvidenceManifest, createAcquisitionNavigatorReadinessAttestation } from './audit-acquisition-navigator.mjs';
import { createAcquisitionNavigatorPlaybooks, createAcquisitionNavigatorDecisionDeck, createAcquisitionNavigatorEscalationMoments } from './playbooks-acquisition-navigator.mjs';

export function buildAcquisitionNavigatorSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionNavigatorWorkspace(workspaceName);
  const policies = createAcquisitionNavigatorPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionNavigatorWorkspace(workspace),
    narratives: createAcquisitionNavigatorNarratives(workspace),
    coverage: createAcquisitionNavigatorCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionNavigatorPolicies(policies),
    validation: validateAcquisitionNavigatorPolicies(policies),
    escalationDeck: createAcquisitionNavigatorEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionNavigatorAnalyticsTimeline(),
      forecast: createAcquisitionNavigatorForecastEnvelope(),
      exceptions: createAcquisitionNavigatorExceptionLedger(),
      summary: summarizeAcquisitionNavigatorAnalytics()
    },
    operations: {
      board: createAcquisitionNavigatorOperationsBoard(),
      checklist: createAcquisitionNavigatorShiftChecklist(),
      incidents: createAcquisitionNavigatorIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionNavigatorReportCards(),
      packets: createAcquisitionNavigatorReviewPackets(),
      summary: summarizeAcquisitionNavigatorReporting()
    },
    audit: {
      trail: createAcquisitionNavigatorAuditTrail(),
      manifest: createAcquisitionNavigatorEvidenceManifest(),
      attestation: createAcquisitionNavigatorReadinessAttestation()
    },
    playbooks: createAcquisitionNavigatorPlaybooks(),
    decisions: createAcquisitionNavigatorDecisionDeck(),
    escalationMoments: createAcquisitionNavigatorEscalationMoments()
  };
}

export function createAcquisitionNavigatorReadinessBoard(snapshot = buildAcquisitionNavigatorSnapshot()) {
  return [
    { id: 'acquisition-navigator-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-navigator-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-navigator-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-navigator-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionNavigatorApiDocument(snapshot = buildAcquisitionNavigatorSnapshot()) {
  return {
    id: 'acquisition-navigator-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-navigator/overview' },
      { method: 'GET', path: '/api/acquisition-navigator/reporting' },
      { method: 'POST', path: '/api/acquisition-navigator/validate' },
      { method: 'GET', path: '/api/acquisition-navigator/audit' }
    ],
    readiness: createAcquisitionNavigatorReadinessBoard(snapshot)
  };
}

export function createAcquisitionNavigatorRouteSummary(snapshot = buildAcquisitionNavigatorSnapshot()) {
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

