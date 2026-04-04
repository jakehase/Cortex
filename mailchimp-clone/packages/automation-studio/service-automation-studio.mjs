import { createAutomationStudioWorkspace, summarizeAutomationStudioWorkspace, createAutomationStudioNarratives, createAutomationStudioCoverageGrid } from './domain-automation-studio.mjs';
import { createAutomationStudioPolicies, validateAutomationStudioPolicies, summarizeAutomationStudioPolicies, createAutomationStudioEscalationDeck } from './policies-automation-studio.mjs';
import { createAutomationStudioAnalyticsTimeline, createAutomationStudioForecastEnvelope, createAutomationStudioExceptionLedger, summarizeAutomationStudioAnalytics } from './analytics-automation-studio.mjs';
import { createAutomationStudioOperationsBoard, createAutomationStudioShiftChecklist, createAutomationStudioIncidentDeck } from './operations-automation-studio.mjs';
import { createAutomationStudioReportCards, createAutomationStudioReviewPackets, summarizeAutomationStudioReporting } from './reporting-automation-studio.mjs';
import { createAutomationStudioAuditTrail, createAutomationStudioEvidenceManifest, createAutomationStudioReadinessAttestation } from './audit-automation-studio.mjs';
import { createAutomationStudioPlaybooks, createAutomationStudioDecisionDeck, createAutomationStudioEscalationMoments } from './playbooks-automation-studio.mjs';

export function buildAutomationStudioSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationStudioWorkspace(workspaceName);
  const policies = createAutomationStudioPolicies();
  return {
    workspace,
    summary: summarizeAutomationStudioWorkspace(workspace),
    narratives: createAutomationStudioNarratives(workspace),
    coverage: createAutomationStudioCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationStudioPolicies(policies),
    validation: validateAutomationStudioPolicies(policies),
    escalationDeck: createAutomationStudioEscalationDeck(policies),
    analytics: {
      timeline: createAutomationStudioAnalyticsTimeline(),
      forecast: createAutomationStudioForecastEnvelope(),
      exceptions: createAutomationStudioExceptionLedger(),
      summary: summarizeAutomationStudioAnalytics()
    },
    operations: {
      board: createAutomationStudioOperationsBoard(),
      checklist: createAutomationStudioShiftChecklist(),
      incidents: createAutomationStudioIncidentDeck()
    },
    reporting: {
      cards: createAutomationStudioReportCards(),
      packets: createAutomationStudioReviewPackets(),
      summary: summarizeAutomationStudioReporting()
    },
    audit: {
      trail: createAutomationStudioAuditTrail(),
      manifest: createAutomationStudioEvidenceManifest(),
      attestation: createAutomationStudioReadinessAttestation()
    },
    playbooks: createAutomationStudioPlaybooks(),
    decisions: createAutomationStudioDecisionDeck(),
    escalationMoments: createAutomationStudioEscalationMoments()
  };
}

export function createAutomationStudioReadinessBoard(snapshot = buildAutomationStudioSnapshot()) {
  return [
    { id: 'automation-studio-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-studio-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-studio-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-studio-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationStudioApiDocument(snapshot = buildAutomationStudioSnapshot()) {
  return {
    id: 'automation-studio-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-studio/overview' },
      { method: 'GET', path: '/api/automation-studio/reporting' },
      { method: 'POST', path: '/api/automation-studio/validate' },
      { method: 'GET', path: '/api/automation-studio/audit' }
    ],
    readiness: createAutomationStudioReadinessBoard(snapshot)
  };
}

export function createAutomationStudioRouteSummary(snapshot = buildAutomationStudioSnapshot()) {
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

