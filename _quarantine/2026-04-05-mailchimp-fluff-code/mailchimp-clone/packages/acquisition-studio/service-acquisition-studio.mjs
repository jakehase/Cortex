import { createAcquisitionStudioWorkspace, summarizeAcquisitionStudioWorkspace, createAcquisitionStudioNarratives, createAcquisitionStudioCoverageGrid } from './domain-acquisition-studio.mjs';
import { createAcquisitionStudioPolicies, validateAcquisitionStudioPolicies, summarizeAcquisitionStudioPolicies, createAcquisitionStudioEscalationDeck } from './policies-acquisition-studio.mjs';
import { createAcquisitionStudioAnalyticsTimeline, createAcquisitionStudioForecastEnvelope, createAcquisitionStudioExceptionLedger, summarizeAcquisitionStudioAnalytics } from './analytics-acquisition-studio.mjs';
import { createAcquisitionStudioOperationsBoard, createAcquisitionStudioShiftChecklist, createAcquisitionStudioIncidentDeck } from './operations-acquisition-studio.mjs';
import { createAcquisitionStudioReportCards, createAcquisitionStudioReviewPackets, summarizeAcquisitionStudioReporting } from './reporting-acquisition-studio.mjs';
import { createAcquisitionStudioAuditTrail, createAcquisitionStudioEvidenceManifest, createAcquisitionStudioReadinessAttestation } from './audit-acquisition-studio.mjs';
import { createAcquisitionStudioPlaybooks, createAcquisitionStudioDecisionDeck, createAcquisitionStudioEscalationMoments } from './playbooks-acquisition-studio.mjs';

export function buildAcquisitionStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAcquisitionStudioWorkspace(workspaceName);
  const policies = createAcquisitionStudioPolicies();
  return {
    workspace,
    summary: summarizeAcquisitionStudioWorkspace(workspace),
    narratives: createAcquisitionStudioNarratives(workspace),
    coverage: createAcquisitionStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeAcquisitionStudioPolicies(policies),
    validation: validateAcquisitionStudioPolicies(policies),
    escalationDeck: createAcquisitionStudioEscalationDeck(policies),
    analytics: {
      timeline: createAcquisitionStudioAnalyticsTimeline(),
      forecast: createAcquisitionStudioForecastEnvelope(),
      exceptions: createAcquisitionStudioExceptionLedger(),
      summary: summarizeAcquisitionStudioAnalytics()
    },
    operations: {
      board: createAcquisitionStudioOperationsBoard(),
      checklist: createAcquisitionStudioShiftChecklist(),
      incidents: createAcquisitionStudioIncidentDeck()
    },
    reporting: {
      cards: createAcquisitionStudioReportCards(),
      packets: createAcquisitionStudioReviewPackets(),
      summary: summarizeAcquisitionStudioReporting()
    },
    audit: {
      trail: createAcquisitionStudioAuditTrail(),
      manifest: createAcquisitionStudioEvidenceManifest(),
      attestation: createAcquisitionStudioReadinessAttestation()
    },
    playbooks: createAcquisitionStudioPlaybooks(),
    decisions: createAcquisitionStudioDecisionDeck(),
    escalationMoments: createAcquisitionStudioEscalationMoments()
  };
}

export function createAcquisitionStudioReadinessBoard(snapshot = buildAcquisitionStudioSnapshot()) {
  return [
    { id: 'acquisition-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'acquisition-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'acquisition-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'acquisition-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAcquisitionStudioApiDocument(snapshot = buildAcquisitionStudioSnapshot()) {
  return {
    id: 'acquisition-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/acquisition-studio/overview' },
      { method: 'GET', path: '/api/acquisition-studio/reporting' },
      { method: 'POST', path: '/api/acquisition-studio/validate' },
      { method: 'GET', path: '/api/acquisition-studio/audit' }
    ],
    readiness: createAcquisitionStudioReadinessBoard(snapshot)
  };
}

export function createAcquisitionStudioRouteSummary(snapshot = buildAcquisitionStudioSnapshot()) {
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

