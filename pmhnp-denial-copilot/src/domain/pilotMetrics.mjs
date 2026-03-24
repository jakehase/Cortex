import path from 'node:path';

import { STATE_DIR } from '../config.mjs';
import { appendAuditEvent } from '../lib/audit.mjs';
import { ensureDir, listJson, makeId, nowIso, readJson, writeJson } from '../lib/storage.mjs';

const PILOT_DIR = path.join(STATE_DIR, 'pilot-metrics');
const BASELINES_DIR = path.join(PILOT_DIR, 'baselines');
const EVENTS_DIR = path.join(PILOT_DIR, 'events');
const REPORTS_DIR = path.join(PILOT_DIR, 'reports');

function cleanString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeActor(actor = {}) {
  return {
    actor_id: cleanString(actor.actor_id) || 'system',
    role: cleanString(actor.role) || 'system'
  };
}

function baselineFile(practiceSlug) {
  return path.join(BASELINES_DIR, `${practiceSlug}.json`);
}

function eventFile(eventId) {
  return path.join(EVENTS_DIR, `${eventId}.json`);
}

function reportFile(reportId) {
  return path.join(REPORTS_DIR, `${reportId}.json`);
}

function slug(value) {
  return cleanString(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'practice';
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function money(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function ensurePilotDirs() {
  ensureDir(BASELINES_DIR);
  ensureDir(EVENTS_DIR);
  ensureDir(REPORTS_DIR);
}

function listEventsForPractice(practiceSlug) {
  return listJson(EVENTS_DIR)
    .filter((item) => item.practice_slug === practiceSlug)
    .sort((a, b) => String(a.occurred_at || '').localeCompare(String(b.occurred_at || '')));
}

function computeRollup(baseline, events = []) {
  const totals = {
    denials_reviewed: 0,
    denials_overturned: 0,
    prevented_denials: 0,
    dollars_recovered: 0,
    dollars_protected: 0,
    staff_minutes_saved: 0,
    appeal_turnaround_days_improved: 0,
    notes: []
  };

  for (const event of events) {
    totals.denials_reviewed += toNumber(event.metrics?.denials_reviewed);
    totals.denials_overturned += toNumber(event.metrics?.denials_overturned);
    totals.prevented_denials += toNumber(event.metrics?.prevented_denials);
    totals.dollars_recovered += money(event.metrics?.dollars_recovered);
    totals.dollars_protected += money(event.metrics?.dollars_protected);
    totals.staff_minutes_saved += toNumber(event.metrics?.staff_minutes_saved);
    totals.appeal_turnaround_days_improved += toNumber(event.metrics?.appeal_turnaround_days_improved);
    if (event.notes) totals.notes.push(event.notes);
  }

  const hourlyRate = toNumber(baseline.baseline?.billing_staff_hourly_cost, 28);
  const staffSavings = money((totals.staff_minutes_saved / 60) * hourlyRate);
  const totalImpact = money(totals.dollars_recovered + totals.dollars_protected + staffSavings);
  const pilotCost = money(baseline.baseline?.pilot_cost_usd || 0);
  const roiPercent = pilotCost > 0 ? Math.round(((totalImpact - pilotCost) / pilotCost) * 100) : null;
  const overturnRate = totals.denials_reviewed > 0 ? Math.round((totals.denials_overturned / totals.denials_reviewed) * 1000) / 10 : null;
  const preventionRate = baseline.baseline?.monthly_denials_before > 0
    ? Math.round((totals.prevented_denials / toNumber(baseline.baseline.monthly_denials_before)) * 1000) / 10
    : null;

  return {
    totals: {
      ...totals,
      dollars_recovered: money(totals.dollars_recovered),
      dollars_protected: money(totals.dollars_protected),
      staff_cost_saved: staffSavings,
      total_estimated_impact: totalImpact
    },
    roi: {
      pilot_cost_usd: pilotCost,
      estimated_roi_percent: roiPercent,
      overturn_rate_percent: overturnRate,
      prevention_rate_percent_of_baseline_monthly_denials: preventionRate
    },
    evidence_strength: events.length >= 3 ? 'pilot-tracked' : events.length > 0 ? 'early-signal' : 'baseline-only',
    evidence_limits: [
      'Metrics are only as good as the pilot baseline and event entries recorded by the team.',
      'Recovered dollars and prevented dollars are modeled from in-repo pilot records, not payer remittance ingestion.',
      'This repo provides the instrumentation and reporting spine; live production proof still depends on real pilot usage.'
    ]
  };
}

export function upsertPilotBaseline(input = {}, actor = {}) {
  ensurePilotDirs();
  const normalizedActor = normalizeActor(actor);
  const practiceName = cleanString(input.practice_name);
  const practiceSlug = slug(practiceName);
  const baseline = {
    practice_name: practiceName,
    practice_slug: practiceSlug,
    updated_at: nowIso(),
    created_at: readJson(baselineFile(practiceSlug), null)?.created_at || nowIso(),
    use_case: 'Tebra-first PMHNP Claim Guard worklists with ROI proof',
    baseline: {
      monthly_denials_before: toNumber(input.monthly_denials_before),
      denial_rate_before_percent: toNumber(input.denial_rate_before_percent),
      average_days_to_first_touch_before: toNumber(input.average_days_to_first_touch_before),
      average_appeal_turnaround_days_before: toNumber(input.average_appeal_turnaround_days_before),
      average_dollars_at_risk_per_month: money(input.average_dollars_at_risk_per_month),
      billing_staff_hourly_cost: money(input.billing_staff_hourly_cost || 28),
      pilot_cost_usd: money(input.pilot_cost_usd || 0)
    },
    owner: {
      actor_id: normalizedActor.actor_id,
      role: normalizedActor.role
    }
  };

  writeJson(baselineFile(practiceSlug), baseline);
  appendAuditEvent({
    type: 'pilot.baseline.upserted',
    actor: normalizedActor,
    subject: { kind: 'pilot_baseline', practice_slug: practiceSlug },
    details: baseline.baseline
  });

  return { ok: true, status: 201, baseline };
}

export function recordPilotEvent(input = {}, actor = {}) {
  ensurePilotDirs();
  const normalizedActor = normalizeActor(actor);
  const practiceName = cleanString(input.practice_name);
  const practiceSlug = slug(practiceName);
  const baseline = readJson(baselineFile(practiceSlug), null);

  if (!baseline) {
    return {
      ok: false,
      status: 404,
      error: 'PILOT_BASELINE_NOT_FOUND',
      message: 'Create a pilot baseline before recording pilot ROI events.'
    };
  }

  const eventId = makeId('pilot_event');
  const event = {
    event_id: eventId,
    practice_name: practiceName,
    practice_slug: practiceSlug,
    occurred_at: cleanString(input.occurred_at) || nowIso(),
    updated_at: nowIso(),
    category: cleanString(input.category) || 'denial-ops',
    notes: cleanString(input.notes) || null,
    metrics: {
      denials_reviewed: toNumber(input.denials_reviewed),
      denials_overturned: toNumber(input.denials_overturned),
      prevented_denials: toNumber(input.prevented_denials),
      dollars_recovered: money(input.dollars_recovered),
      dollars_protected: money(input.dollars_protected),
      staff_minutes_saved: toNumber(input.staff_minutes_saved),
      appeal_turnaround_days_improved: toNumber(input.appeal_turnaround_days_improved)
    },
    actor: normalizedActor
  };

  writeJson(eventFile(eventId), event);
  appendAuditEvent({
    type: 'pilot.event.recorded',
    actor: normalizedActor,
    subject: { kind: 'pilot_event', event_id: eventId, practice_slug: practiceSlug },
    details: event.metrics
  });

  return { ok: true, status: 201, event };
}

export function generatePilotReport(input = {}, actor = {}) {
  ensurePilotDirs();
  const normalizedActor = normalizeActor(actor);
  const practiceName = cleanString(input.practice_name);
  const practiceSlug = slug(practiceName);
  const baseline = readJson(baselineFile(practiceSlug), null);

  if (!baseline) {
    return {
      ok: false,
      status: 404,
      error: 'PILOT_BASELINE_NOT_FOUND',
      message: 'Create a pilot baseline before generating a pilot report.'
    };
  }

  const events = listEventsForPractice(practiceSlug);
  const rollup = computeRollup(baseline, events);
  const report = {
    report_id: makeId('pilot_report'),
    created_at: nowIso(),
    updated_at: nowIso(),
    practice_name: baseline.practice_name,
    practice_slug: practiceSlug,
    headline: 'PMHNP denial-ops pilot report',
    use_case: baseline.use_case,
    baseline,
    event_count: events.length,
    events,
    ...rollup,
    recommended_next_steps: [
      'Keep recording overturned denials, prevented denials, and staff minutes saved each week.',
      'Review denial feedback labels to tighten the PMHNP ruleset over time.',
      'Use this report in pilot reviews to prove whether Tebra-first PMHNP Claim Guard worklists are financially credible.'
    ]
  };

  writeJson(reportFile(report.report_id), report);
  appendAuditEvent({
    type: 'pilot.report.generated',
    actor: normalizedActor,
    subject: { kind: 'pilot_report', report_id: report.report_id, practice_slug: practiceSlug },
    details: {
      event_count: report.event_count,
      total_estimated_impact: report.totals.total_estimated_impact,
      estimated_roi_percent: report.roi.estimated_roi_percent
    }
  });

  return { ok: true, status: 201, report };
}

export function getPilotReport(practiceName) {
  ensurePilotDirs();
  const practiceSlug = slug(practiceName);
  const baseline = readJson(baselineFile(practiceSlug), null);
  if (!baseline) return null;
  return generatePilotReport({ practice_name: baseline.practice_name }, { actor_id: 'system', role: 'system' }).report;
}

export function listPilotBaselines() {
  ensurePilotDirs();
  return listJson(BASELINES_DIR).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}
