import { createAutomationAtlasWorkspace, summarizeAutomationAtlasWorkspace, createAutomationAtlasNarratives, createAutomationAtlasCoverageGrid } from './domain-automation-atlas.mjs';
import { createAutomationAtlasPolicies, validateAutomationAtlasPolicies, summarizeAutomationAtlasPolicies, createAutomationAtlasEscalationDeck } from './policies-automation-atlas.mjs';
import { createAutomationAtlasAnalyticsTimeline, createAutomationAtlasForecastEnvelope, createAutomationAtlasExceptionLedger, summarizeAutomationAtlasAnalytics } from './analytics-automation-atlas.mjs';
import { createAutomationAtlasOperationsBoard, createAutomationAtlasShiftChecklist, createAutomationAtlasIncidentDeck } from './operations-automation-atlas.mjs';
import { createAutomationAtlasReportCards, createAutomationAtlasReviewPackets, summarizeAutomationAtlasReporting } from './reporting-automation-atlas.mjs';
import { createAutomationAtlasAuditTrail, createAutomationAtlasEvidenceManifest, createAutomationAtlasReadinessAttestation } from './audit-automation-atlas.mjs';
import { createAutomationAtlasPlaybooks, createAutomationAtlasDecisionDeck, createAutomationAtlasEscalationMoments } from './playbooks-automation-atlas.mjs';

export function buildAutomationAtlasSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createAutomationAtlasWorkspace(workspaceName);
  const policies = createAutomationAtlasPolicies();
  return {
    workspace,
    summary: summarizeAutomationAtlasWorkspace(workspace),
    narratives: createAutomationAtlasNarratives(workspace),
    coverage: createAutomationAtlasCoverageGrid(workspace),
    policies,
    policySummary: summarizeAutomationAtlasPolicies(policies),
    validation: validateAutomationAtlasPolicies(policies),
    escalationDeck: createAutomationAtlasEscalationDeck(policies),
    analytics: {
      timeline: createAutomationAtlasAnalyticsTimeline(),
      forecast: createAutomationAtlasForecastEnvelope(),
      exceptions: createAutomationAtlasExceptionLedger(),
      summary: summarizeAutomationAtlasAnalytics()
    },
    operations: {
      board: createAutomationAtlasOperationsBoard(),
      checklist: createAutomationAtlasShiftChecklist(),
      incidents: createAutomationAtlasIncidentDeck()
    },
    reporting: {
      cards: createAutomationAtlasReportCards(),
      packets: createAutomationAtlasReviewPackets(),
      summary: summarizeAutomationAtlasReporting()
    },
    audit: {
      trail: createAutomationAtlasAuditTrail(),
      manifest: createAutomationAtlasEvidenceManifest(),
      attestation: createAutomationAtlasReadinessAttestation()
    },
    playbooks: createAutomationAtlasPlaybooks(),
    decisions: createAutomationAtlasDecisionDeck(),
    escalationMoments: createAutomationAtlasEscalationMoments()
  };
}

export function createAutomationAtlasReadinessBoard(snapshot = buildAutomationAtlasSnapshot()) {
  return [
    { id: 'automation-atlas-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'automation-atlas-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'automation-atlas-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'automation-atlas-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createAutomationAtlasApiDocument(snapshot = buildAutomationAtlasSnapshot()) {
  return {
    id: 'automation-atlas-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/automation-atlas/overview' },
      { method: 'GET', path: '/api/automation-atlas/reporting' },
      { method: 'POST', path: '/api/automation-atlas/validate' },
      { method: 'GET', path: '/api/automation-atlas/audit' }
    ],
    readiness: createAutomationAtlasReadinessBoard(snapshot)
  };
}

export function createAutomationAtlasRouteSummary(snapshot = buildAutomationAtlasSnapshot()) {
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

