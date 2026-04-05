import { createChannelConsoleWorkspace, summarizeChannelConsoleWorkspace, createChannelConsoleNarratives, createChannelConsoleCoverageGrid } from './domain-channel-console.mjs';
import { createChannelConsolePolicies, validateChannelConsolePolicies, summarizeChannelConsolePolicies, createChannelConsoleEscalationDeck } from './policies-channel-console.mjs';
import { createChannelConsoleAnalyticsTimeline, createChannelConsoleForecastEnvelope, createChannelConsoleExceptionLedger, summarizeChannelConsoleAnalytics } from './analytics-channel-console.mjs';
import { createChannelConsoleOperationsBoard, createChannelConsoleShiftChecklist, createChannelConsoleIncidentDeck } from './operations-channel-console.mjs';
import { createChannelConsoleReportCards, createChannelConsoleReviewPackets, summarizeChannelConsoleReporting } from './reporting-channel-console.mjs';
import { createChannelConsoleAuditTrail, createChannelConsoleEvidenceManifest, createChannelConsoleReadinessAttestation } from './audit-channel-console.mjs';
import { createChannelConsolePlaybooks, createChannelConsoleDecisionDeck, createChannelConsoleEscalationMoments } from './playbooks-channel-console.mjs';

export function buildChannelConsoleSnapshot(workspaceName = 'Scale Wave Seven workspace') {
  const workspace = createChannelConsoleWorkspace(workspaceName);
  const policies = createChannelConsolePolicies();
  return {
    workspace,
    summary: summarizeChannelConsoleWorkspace(workspace),
    narratives: createChannelConsoleNarratives(workspace),
    coverage: createChannelConsoleCoverageGrid(workspace),
    policies,
    policySummary: summarizeChannelConsolePolicies(policies),
    validation: validateChannelConsolePolicies(policies),
    escalationDeck: createChannelConsoleEscalationDeck(policies),
    analytics: {
      timeline: createChannelConsoleAnalyticsTimeline(),
      forecast: createChannelConsoleForecastEnvelope(),
      exceptions: createChannelConsoleExceptionLedger(),
      summary: summarizeChannelConsoleAnalytics()
    },
    operations: {
      board: createChannelConsoleOperationsBoard(),
      checklist: createChannelConsoleShiftChecklist(),
      incidents: createChannelConsoleIncidentDeck()
    },
    reporting: {
      cards: createChannelConsoleReportCards(),
      packets: createChannelConsoleReviewPackets(),
      summary: summarizeChannelConsoleReporting()
    },
    audit: {
      trail: createChannelConsoleAuditTrail(),
      manifest: createChannelConsoleEvidenceManifest(),
      attestation: createChannelConsoleReadinessAttestation()
    },
    playbooks: createChannelConsolePlaybooks(),
    decisions: createChannelConsoleDecisionDeck(),
    escalationMoments: createChannelConsoleEscalationMoments()
  };
}

export function createChannelConsoleReadinessBoard(snapshot = buildChannelConsoleSnapshot()) {
  return [
    { id: 'channel-console-readiness-1', label: 'Policy validation', ok: snapshot.validation.ok },
    { id: 'channel-console-readiness-2', label: 'Evidence manifest depth', ok: snapshot.audit.manifest.length >= 4 },
    { id: 'channel-console-readiness-3', label: 'Operational coverage', ok: snapshot.operations.board.length >= 4 },
    { id: 'channel-console-readiness-4', label: 'Executive reporting', ok: snapshot.reporting.summary.executiveCards >= 2 }
  ];
}

export function createChannelConsoleApiDocument(snapshot = buildChannelConsoleSnapshot()) {
  return {
    id: 'channel-console-api-document',
    title: snapshot.summary.title + ' API document',
    endpoints: [
      { method: 'GET', path: '/api/channel-console/overview' },
      { method: 'GET', path: '/api/channel-console/reporting' },
      { method: 'POST', path: '/api/channel-console/validate' },
      { method: 'GET', path: '/api/channel-console/audit' }
    ],
    readiness: createChannelConsoleReadinessBoard(snapshot)
  };
}

export function createChannelConsoleRouteSummary(snapshot = buildChannelConsoleSnapshot()) {
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

