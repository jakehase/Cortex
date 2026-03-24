import path from 'node:path';

import { STATE_DIR } from '../config.mjs';
import { appendAuditEvent } from '../lib/audit.mjs';
import { clone, ensureDir, listJson, makeId, nowIso, readJson, toFileSlug, writeJson } from '../lib/storage.mjs';

const DENIAL_ROOT_DIR = path.join(STATE_DIR, 'denial-intelligence');
const RULESETS_DIR = path.join(DENIAL_ROOT_DIR, 'rulesets');
const FEEDBACK_DIR = path.join(DENIAL_ROOT_DIR, 'feedback');
const ARTIFACTS_DIR = path.join(DENIAL_ROOT_DIR, 'artifacts');
const WORKLISTS_DIR = path.join(DENIAL_ROOT_DIR, 'worklists');
const LEARNING_STATS_PATH = path.join(DENIAL_ROOT_DIR, 'learning-stats.json');

const PMHNP_DENIAL_TAXONOMY = Object.freeze({
  specialty: 'PMHNP',
  use_case: 'Tebra-first PMHNP claim-risk screening and denial recovery for outpatient psych claims and prior auth follow-up',
  buckets: [
    {
      code: 'AUTH-PA-MISSING',
      title: 'Missing or expired authorization',
      severity: 'high',
      route_to: 'authorization_team',
      why_it_happens: 'Psych med management and therapy claims often fail when auth windows, visit counts, or servicing provider details are out of sync.',
      tebra_signals: ['authorization report', 'referral export', 'claim note contains auth pending'],
      payer_examples: ['CO-197', 'prior auth absent', 'authorization date range mismatch'],
      recommended_actions: [
        'Verify auth number, date span, visit limit, and rendering provider match.',
        'Attach auth reference to the denial work item before appeal/resubmit.',
        'If no auth exists, route to retrospective auth or patient liability workflow.'
      ]
    },
    {
      code: 'TEL-POS-MOD',
      title: 'Telehealth POS / modifier mismatch',
      severity: 'high',
      route_to: 'coding_review',
      why_it_happens: 'PMHNP telehealth claims frequently deny when POS 02/10 and modifier 95/GT do not match payer rules.',
      tebra_signals: ['telehealth', 'modifier 95', 'POS 02', 'POS 10'],
      payer_examples: ['CO-4', 'CO-16', 'invalid place of service', 'modifier inconsistent'],
      recommended_actions: [
        'Check payer-specific telehealth billing rule for DOS and service type.',
        'Correct POS/modifier pairing before corrected claim submission.',
        'Document whether service was home-based or non-home telehealth.'
      ]
    },
    {
      code: 'DOC-PSYCH-NOTE',
      title: 'Documentation support missing for psych service',
      severity: 'high',
      route_to: 'clinician_queue',
      why_it_happens: 'Psychiatric evals, therapy add-ons, and med management claims can deny when note signature, time, or service support is incomplete.',
      tebra_signals: ['unsigned note', 'missing time', 'psychotherapy add-on', '90833', '90792'],
      payer_examples: ['medical records requested', 'documentation does not support service', 'CO-16 additional information'],
      recommended_actions: [
        'Confirm signed note exists and supports billed CPT combination.',
        'Validate documented time supports psychotherapy add-on usage.',
        'Queue clinician addendum before appeal packet is drafted.'
      ]
    },
    {
      code: 'ELIG-COB-COVERAGE',
      title: 'Eligibility / COB / inactive coverage',
      severity: 'high',
      route_to: 'front_office',
      why_it_happens: 'Behavioral health claims often deny when payer order, coverage dates, or plan carve-out details were not verified before service.',
      tebra_signals: ['eligibility', 'inactive member', 'secondary payer', 'behavioral carve-out'],
      payer_examples: ['CO-27', 'CO-22', 'other coverage primary', 'subscriber not found'],
      recommended_actions: [
        'Re-run eligibility and verify behavioral health carve-out payer.',
        'Update COB order in Tebra before resubmission.',
        'If coverage truly inactive, route to patient statement or self-pay workflow.'
      ]
    },
    {
      code: 'TIMELY-FILING',
      title: 'Timely filing risk or denial',
      severity: 'critical',
      route_to: 'escalation_queue',
      why_it_happens: 'Older PMHNP claims and secondary follow-up can silently age past filing windows if no denial watchlist exists.',
      tebra_signals: ['aging', 'older than 75 days', 'deadline', 'timely filing'],
      payer_examples: ['CO-29', 'filing limit expired'],
      recommended_actions: [
        'Prioritize payer deadline validation immediately.',
        'Draft appeal packet with proof of timely filing if available.',
        'Escalate same day because recovery odds decay fast.'
      ]
    },
    {
      code: 'NPI-TAXONOMY-CAQH',
      title: 'NPI / taxonomy / enrollment mismatch',
      severity: 'medium',
      route_to: 'credentialing',
      why_it_happens: 'PMHNP claims can deny when rendering taxonomy, group enrollment, or billing NPI details are misaligned across Tebra and payer files.',
      tebra_signals: ['taxonomy', 'rendering npi', 'billing npi', 'credentialing'],
      payer_examples: ['provider not eligible', 'taxonomy mismatch', 'rendering provider not enrolled'],
      recommended_actions: [
        'Validate rendering and billing NPI against payer enrollment records.',
        'Check PMHNP taxonomy and supervising/collaborating requirements where applicable.',
        'Update Tebra mapping and payer enrollment records before rebill.'
      ]
    }
  ]
});

const DEFAULT_RULE_CONFIDENCE = 0.62;
const MIN_RULE_CONFIDENCE = 0.2;
const MAX_RULE_CONFIDENCE = 0.97;

const SPECIALTY_RULESET = Object.freeze({
  ruleset_id: 'pmhnp-tebra-denial-v2',
  specialty: 'PMHNP',
  version: 2,
  use_case: 'Tebra-first PMHNP claim-risk and denial-recovery worklist generation with persisted feedback learning',
  rules: [
    {
      rule_id: 'PMHNP-R001',
      denial_code: 'AUTH-PA-MISSING',
      title: 'Psych prior auth required but absent or stale',
      match: ['auth', 'authorization', 'referral', 'precert', '197', 'prior authorization', 'pa missing'],
      severity: 'high',
      base_confidence: 0.7
    },
    {
      rule_id: 'PMHNP-R002',
      denial_code: 'TEL-POS-MOD',
      title: 'Telehealth POS/modifier mismatch',
      match: ['telehealth', 'pos 02', 'pos 10', 'modifier 95', 'gt', 'invalid place of service'],
      severity: 'high',
      base_confidence: 0.7
    },
    {
      rule_id: 'PMHNP-R003',
      denial_code: 'DOC-PSYCH-NOTE',
      title: 'Psych documentation does not support billed service',
      match: ['unsigned note', 'missing time', 'records', '90833', '90792', 'documentation does not support'],
      severity: 'high',
      base_confidence: 0.68
    },
    {
      rule_id: 'PMHNP-R004',
      denial_code: 'ELIG-COB-COVERAGE',
      title: 'Eligibility or behavioral carve-out problem',
      match: ['eligibility', 'inactive', 'subscriber', 'cob', 'carve-out', 'other coverage'],
      severity: 'high',
      base_confidence: 0.66
    },
    {
      rule_id: 'PMHNP-R005',
      denial_code: 'TIMELY-FILING',
      title: 'Timely filing risk on aging PMHNP claim',
      match: ['aging', 'deadline', 'timely filing', 'filing limit', 'co-29', 'older than 90 days'],
      severity: 'critical',
      base_confidence: 0.72
    },
    {
      rule_id: 'PMHNP-R006',
      denial_code: 'NPI-TAXONOMY-CAQH',
      title: 'Rendering/billing NPI or taxonomy mismatch',
      match: ['taxonomy', 'rendering npi', 'billing npi', 'enrollment', 'provider not eligible'],
      severity: 'medium',
      base_confidence: 0.6
    }
  ]
});

function cleanString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeActor(actor = {}) {
  return {
    actor_id: cleanString(actor.actor_id) || 'system',
    role: cleanString(actor.role) || 'system'
  };
}

function feedbackFile(feedbackId) {
  return path.join(FEEDBACK_DIR, `${feedbackId}.json`);
}

function artifactFile(artifactId) {
  return path.join(ARTIFACTS_DIR, `${artifactId}.json`);
}

function worklistFile(worklistId) {
  return path.join(WORKLISTS_DIR, `${worklistId}.json`);
}

function rulesetFile() {
  return path.join(RULESETS_DIR, `${SPECIALTY_RULESET.ruleset_id}.json`);
}

function defaultLearningStats() {
  const byRule = Object.fromEntries(SPECIALTY_RULESET.rules.map((rule) => [rule.rule_id, {
    rule_id: rule.rule_id,
    denial_code: rule.denial_code,
    base_confidence: rule.base_confidence ?? DEFAULT_RULE_CONFIDENCE,
    learned_confidence: rule.base_confidence ?? DEFAULT_RULE_CONFIDENCE,
    uses: 0,
    confirmed: 0,
    corrected: 0,
    false_positive: 0,
    false_negative: 0,
    reviewer_confirmed_outcomes: 0,
    last_feedback_at: null
  }]));

  const byBucket = Object.fromEntries(PMHNP_DENIAL_TAXONOMY.buckets.map((bucket) => [bucket.code, {
    denial_code: bucket.code,
    predicted_count: 0,
    confirmed_count: 0,
    corrected_away_count: 0,
    corrected_to_count: 0,
    reviewer_outcomes: {},
    last_seen_at: null
  }]));

  return {
    specialty: 'PMHNP',
    ruleset_id: SPECIALTY_RULESET.ruleset_id,
    updated_at: nowIso(),
    totals: {
      scored_cases: 0,
      feedback_records: 0,
      reviewer_confirmed_outcomes: 0,
      ingested_artifacts: 0,
      normalized_records: 0,
      routed_worklist_items: 0
    },
    by_rule: byRule,
    by_bucket: byBucket,
    label_drift: {},
    outcome_distribution: {},
    route_distribution: {},
    artifact_types_seen: {},
    recent_worklists: []
  };
}

function ensureSeeded() {
  ensureDir(RULESETS_DIR);
  ensureDir(FEEDBACK_DIR);
  ensureDir(ARTIFACTS_DIR);
  ensureDir(WORKLISTS_DIR);
  const current = readJson(rulesetFile(), null);
  if (!current) {
    writeJson(rulesetFile(), SPECIALTY_RULESET);
  }
  const learning = readJson(LEARNING_STATS_PATH, null);
  if (!learning) {
    writeJson(LEARNING_STATS_PATH, defaultLearningStats());
  }
}

function taxonomyByCode(code) {
  return PMHNP_DENIAL_TAXONOMY.buckets.find((item) => item.code === code) || null;
}

function inferCategoryText(input = {}) {
  return [
    input.category,
    input.denial_reason,
    input.payer_message,
    input.claim_note,
    input.pos,
    input.modifier,
    input.status,
    input.reason_code,
    ...(Array.isArray(input.artifact_names) ? input.artifact_names : [])
  ].filter(Boolean).join(' ').toLowerCase();
}

function readLearningStats() {
  ensureSeeded();
  return readJson(LEARNING_STATS_PATH, defaultLearningStats());
}

function writeLearningStats(stats) {
  stats.updated_at = nowIso();
  writeJson(LEARNING_STATS_PATH, stats);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function severityRank(severity) {
  const rank = { critical: 4, high: 3, medium: 2, low: 1 };
  return rank[severity] || 0;
}

function rate(numerator, denominator, fallback = 0) {
  if (!denominator) return fallback;
  return numerator / denominator;
}

function normalizeRule(rule, stats) {
  const learned = stats?.by_rule?.[rule.rule_id];
  return {
    ...rule,
    base_confidence: rule.base_confidence ?? DEFAULT_RULE_CONFIDENCE,
    learned_confidence: clamp(learned?.learned_confidence ?? rule.base_confidence ?? DEFAULT_RULE_CONFIDENCE, MIN_RULE_CONFIDENCE, MAX_RULE_CONFIDENCE),
    learning_stats: learned || null
  };
}

function buildRuleMatch(rule, haystack, input, stats) {
  const matchedTerms = rule.match.filter((term) => haystack.includes(term.toLowerCase()));
  if (!matchedTerms.length) return null;

  const bucket = taxonomyByCode(rule.denial_code);
  const normalizedRule = normalizeRule(rule, stats);
  const ageBoost = Number(input.claim_age_days || 0) >= 90 && rule.denial_code === 'TIMELY-FILING' ? 0.12 : 0;
  const artifactBoost = Array.isArray(input.artifact_names) && input.artifact_names.length ? 0.03 : 0;
  const matchedTermBoost = Math.min(0.12, matchedTerms.length * 0.03);
  const score = clamp(normalizedRule.learned_confidence + matchedTermBoost + ageBoost + artifactBoost, 0, 0.99);

  return {
    rule_id: rule.rule_id,
    denial_code: rule.denial_code,
    title: rule.title,
    severity: rule.severity,
    matched_terms: matchedTerms,
    route_to: bucket?.route_to || 'billing_follow_up',
    recommended_actions: bucket?.recommended_actions || [],
    confidence: Number(score.toFixed(3)),
    confidence_components: {
      base_confidence: normalizedRule.base_confidence,
      learned_confidence: normalizedRule.learned_confidence,
      matched_term_boost: Number(matchedTermBoost.toFixed(3)),
      age_boost: Number(ageBoost.toFixed(3)),
      artifact_boost: Number(artifactBoost.toFixed(3))
    },
    learning_stats: normalizedRule.learning_stats
  };
}

function updateStatsForScore(stats, result) {
  stats.totals.scored_cases += 1;
  if (result.primary_match?.rule_id && stats.by_rule[result.primary_match.rule_id]) {
    stats.by_rule[result.primary_match.rule_id].uses += 1;
    stats.by_rule[result.primary_match.rule_id].last_feedback_at = nowIso();
  }
  if (result.primary_match?.denial_code && stats.by_bucket[result.primary_match.denial_code]) {
    stats.by_bucket[result.primary_match.denial_code].predicted_count += 1;
    stats.by_bucket[result.primary_match.denial_code].last_seen_at = nowIso();
  }
  stats.route_distribution[result.route_to] = (stats.route_distribution[result.route_to] || 0) + 1;
}

function transitionKey(from, to) {
  return `${from || 'unlabeled'}->${to || 'unlabeled'}`;
}

function adjustRuleConfidence(current, signal, matchedReviewerLabel) {
  let next = current;
  if (signal === 'confirmed') next += 0.035;
  if (signal === 'reviewer-confirmed-outcome') next += 0.03;
  if (signal === 'label-drift') next -= 0.055;
  if (signal === 'false-positive') next -= 0.08;
  if (signal === 'false-negative') next -= 0.045;
  if (matchedReviewerLabel) next += 0.02;
  return clamp(Number(next.toFixed(3)), MIN_RULE_CONFIDENCE, MAX_RULE_CONFIDENCE);
}

function normalizeLearningSignal(inputSignal, predicted, reviewer) {
  const signal = cleanString(inputSignal).toLowerCase();
  if (signal) return signal;
  if (reviewer && predicted && reviewer !== predicted) return 'label-drift';
  if (reviewer && predicted && reviewer === predicted) return 'confirmed';
  return 'pending-review';
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(current);
      if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
      row = [];
      current = '';
      continue;
    }
    current += char;
  }
  row.push(current);
  if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((value) => String(value).trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? '').trim()])));
}

function normalizeKey(key) {
  return String(key || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function pick(record, keys) {
  for (const key of keys) {
    if (record[key] != null && String(record[key]).trim() !== '') return record[key];
  }
  return null;
}

function artifactTypeFromName(name, contentType) {
  const lowered = `${name || ''} ${contentType || ''}`.toLowerCase();
  if (lowered.includes('worklist')) return 'worklist';
  if (lowered.includes('remit') || lowered.includes('era') || lowered.includes('835')) return 'remit';
  if (lowered.includes('denial')) return 'denial-export';
  if (lowered.includes('claim') || lowered.includes('ar')) return 'claims-export';
  return 'generic-export';
}

function normalizeDenialRecord(record, artifactMeta = {}) {
  const normalizedRecord = Object.fromEntries(Object.entries(record).map(([key, value]) => [normalizeKey(key), value]));
  const claimRef = cleanString(pick(normalizedRecord, ['claim_id', 'claim_ref', 'claim_number', 'claimno', 'claim'])) || makeId('claim');
  const payer = cleanString(pick(normalizedRecord, ['payer', 'payer_name', 'insurance', 'plan']));
  const denialReason = cleanString(pick(normalizedRecord, ['denial_reason', 'reason', 'reason_description', 'remark', 'message', 'status_reason', 'denialmessage']));
  const payerMessage = cleanString(pick(normalizedRecord, ['payer_message', 'remark', 'message', 'reason_description']));
  const cpt = cleanString(pick(normalizedRecord, ['cpt', 'cpt_code', 'procedure_code', 'proc_code']));
  const pos = cleanString(pick(normalizedRecord, ['pos', 'place_of_service', 'placeofservice']));
  const modifier = cleanString(pick(normalizedRecord, ['modifier', 'modifiers']));
  const amount = Number(pick(normalizedRecord, ['amount', 'charge_amount', 'balance', 'patient_balance', 'denied_amount']) || 0) || 0;
  const claimAgeDays = Number(pick(normalizedRecord, ['claim_age_days', 'age_days', 'days_outstanding', 'days_in_ar']) || 0) || 0;
  const denialCode = cleanString(pick(normalizedRecord, ['denial_code', 'adjustment_code', 'carc', 'code'])) || null;
  const status = cleanString(pick(normalizedRecord, ['status', 'claim_status'])) || 'denied';
  const patient = cleanString(pick(normalizedRecord, ['patient_name', 'patient', 'patient_full_name'])) || null;
  const dos = cleanString(pick(normalizedRecord, ['dos', 'date_of_service', 'service_date'])) || null;

  return {
    source_artifact_id: artifactMeta.artifact_id || null,
    source_artifact_name: artifactMeta.name || null,
    source_artifact_type: artifactMeta.artifact_type || null,
    claim_ref: claimRef,
    payer,
    patient,
    dos,
    cpt,
    pos,
    modifier,
    denial_code_raw: denialCode,
    denial_reason: denialReason || payerMessage || status,
    payer_message: payerMessage || denialReason || null,
    claim_note: cleanString(pick(normalizedRecord, ['claim_note', 'note', 'notes'])) || null,
    amount_at_risk: amount,
    claim_age_days: claimAgeDays,
    status,
    raw_record: normalizedRecord
  };
}

function normalizeJsonRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.records)) return payload.records;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function ingestArtifactPayload(artifact = {}) {
  const content = cleanString(artifact.content || '');
  const name = cleanString(artifact.name) || 'artifact';
  const contentType = cleanString(artifact.content_type || artifact.mime_type) || 'text/plain';
  const format = cleanString(artifact.format).toLowerCase() || (name.toLowerCase().endsWith('.json') ? 'json' : 'csv');

  let records = [];
  if (format === 'json') {
    records = normalizeJsonRecords(JSON.parse(content));
  } else {
    records = parseCsv(content);
  }

  const artifactType = cleanString(artifact.artifact_type) || artifactTypeFromName(name, contentType);
  return {
    artifact_id: makeId('artifact'),
    name,
    content_type: contentType,
    format,
    artifact_type: artifactType,
    record_count: records.length,
    parsed_records: records
  };
}

export function getDenialTaxonomy() {
  ensureSeeded();
  return clone(PMHNP_DENIAL_TAXONOMY);
}

export function getSpecialtyRuleset() {
  ensureSeeded();
  return readJson(rulesetFile(), SPECIALTY_RULESET);
}

export function getDenialLearningStats() {
  return readLearningStats();
}

export function scoreDenial(input = {}, actor = {}) {
  ensureSeeded();
  const normalizedActor = normalizeActor(actor);
  const haystack = inferCategoryText(input);
  const ruleset = getSpecialtyRuleset();
  const stats = readLearningStats();
  const matches = [];

  for (const rule of ruleset.rules) {
    const match = buildRuleMatch(rule, haystack, input, stats);
    if (match) matches.push(match);
  }

  matches.sort((a, b) => {
    if (severityRank(b.severity) !== severityRank(a.severity)) return severityRank(b.severity) - severityRank(a.severity);
    return b.confidence - a.confidence;
  });

  const primary = matches[0] || null;
  const bucketStats = primary?.denial_code ? stats.by_bucket?.[primary.denial_code] : null;
  const confidenceLabel = primary?.confidence >= 0.82 ? 'high' : primary?.confidence >= 0.64 ? 'medium' : primary ? 'watch' : 'none';
  const result = {
    ok: true,
    status: 200,
    specialty: 'PMHNP',
    use_case: PMHNP_DENIAL_TAXONOMY.use_case,
    ruleset_id: ruleset.ruleset_id,
    input_summary: {
      payer: cleanString(input.payer) || null,
      cpt: cleanString(input.cpt) || null,
      denial_reason: cleanString(input.denial_reason) || null,
      claim_age_days: Number(input.claim_age_days || 0) || null,
      amount_at_risk: Number(input.amount_at_risk || 0) || 0
    },
    primary_match: primary,
    matches,
    route_to: primary?.route_to || 'billing_follow_up',
    confidence: primary?.confidence || 0,
    confidence_label: confidenceLabel,
    learning_context: primary ? {
      predicted_count: bucketStats?.predicted_count || 0,
      confirmed_rate: Number(rate(bucketStats?.confirmed_count || 0, bucketStats?.predicted_count || 0, 0).toFixed(3)),
      corrected_away_count: bucketStats?.corrected_away_count || 0,
      label_drift_watch: Object.entries(stats.label_drift || {})
        .filter(([key]) => key.startsWith(`${primary.denial_code}->`) && !key.endsWith(`->${primary.denial_code}`))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([transition, count]) => ({ transition, count }))
    } : null,
    recommended_actions: Array.from(new Set(matches.flatMap((item) => item.recommended_actions))).slice(0, 6),
    feedback_loop_ready: true,
    message: primary
      ? `Mapped denial to ${primary.denial_code} with ${confidenceLabel} confidence using PMHNP specialty rules plus persisted reviewer feedback.`
      : 'No specialty rule match found yet. Human review should label this denial and feed back the outcome.'
  };

  updateStatsForScore(stats, result);
  writeLearningStats(stats);

  appendAuditEvent({
    type: 'denial.score.completed',
    actor: normalizedActor,
    subject: { kind: 'denial_case', denial_code: primary?.denial_code || null, claim_ref: cleanString(input.claim_ref) || null },
    details: {
      match_count: matches.length,
      primary_rule_id: primary?.rule_id || null,
      route_to: result.route_to,
      confidence: result.confidence
    }
  });

  return result;
}

export function recordDenialFeedback(input = {}, actor = {}) {
  ensureSeeded();
  const normalizedActor = normalizeActor(actor);
  const feedbackId = makeId('feedback');
  const scored = scoreDenial(input, actor);
  const predicted = scored.primary_match?.denial_code || null;
  const reviewerLabel = cleanString(input.reviewer_label) || null;
  const learningSignal = normalizeLearningSignal(input.learning_signal, predicted, reviewerLabel);
  const actualOutcome = cleanString(input.actual_outcome) || 'pending-review';
  const stats = readLearningStats();
  const matchedReviewerRule = getSpecialtyRuleset().rules.find((rule) => rule.denial_code === reviewerLabel) || null;
  const record = {
    feedback_id: feedbackId,
    created_at: nowIso(),
    updated_at: nowIso(),
    specialty: 'PMHNP',
    claim_ref: cleanString(input.claim_ref) || null,
    session_id: cleanString(input.session_id) || null,
    predicted_denial_code: predicted,
    predicted_rule_id: scored.primary_match?.rule_id || null,
    actual_outcome: actualOutcome,
    reviewer_label: reviewerLabel,
    payer: cleanString(input.payer) || null,
    notes: cleanString(input.notes) || null,
    learning_signal: learningSignal,
    reviewer_confirmed: Boolean(input.reviewer_confirmed) || learningSignal === 'reviewer-confirmed-outcome' || actualOutcome === 'paid' || actualOutcome === 'appeal-won',
    score_snapshot: scored
  };

  stats.totals.feedback_records += 1;
  stats.outcome_distribution[actualOutcome] = (stats.outcome_distribution[actualOutcome] || 0) + 1;

  if (predicted && stats.by_bucket[predicted]) {
    stats.by_bucket[predicted].last_seen_at = nowIso();
  }
  if (predicted && reviewerLabel) {
    stats.label_drift[transitionKey(predicted, reviewerLabel)] = (stats.label_drift[transitionKey(predicted, reviewerLabel)] || 0) + 1;
  }
  if (scored.primary_match?.rule_id && stats.by_rule[scored.primary_match.rule_id]) {
    const ruleStats = stats.by_rule[scored.primary_match.rule_id];
    if (learningSignal === 'confirmed') ruleStats.confirmed += 1;
    if (learningSignal === 'label-drift') ruleStats.corrected += 1;
    if (learningSignal === 'false-positive') ruleStats.false_positive += 1;
    if (learningSignal === 'false-negative') ruleStats.false_negative += 1;
    if (record.reviewer_confirmed) ruleStats.reviewer_confirmed_outcomes += 1;
    ruleStats.learned_confidence = adjustRuleConfidence(ruleStats.learned_confidence, learningSignal, reviewerLabel === predicted);
    ruleStats.last_feedback_at = nowIso();
  }
  if (predicted && stats.by_bucket[predicted]) {
    if (reviewerLabel === predicted) stats.by_bucket[predicted].confirmed_count += 1;
    if (reviewerLabel && reviewerLabel !== predicted) stats.by_bucket[predicted].corrected_away_count += 1;
    stats.by_bucket[predicted].reviewer_outcomes[actualOutcome] = (stats.by_bucket[predicted].reviewer_outcomes[actualOutcome] || 0) + 1;
  }
  if (reviewerLabel && stats.by_bucket[reviewerLabel]) {
    if (reviewerLabel !== predicted) stats.by_bucket[reviewerLabel].corrected_to_count += 1;
    stats.by_bucket[reviewerLabel].reviewer_outcomes[actualOutcome] = (stats.by_bucket[reviewerLabel].reviewer_outcomes[actualOutcome] || 0) + 1;
  }
  if (record.reviewer_confirmed) {
    stats.totals.reviewer_confirmed_outcomes += 1;
  }

  writeLearningStats(stats);
  writeJson(feedbackFile(feedbackId), record);
  appendAuditEvent({
    type: 'denial.feedback.recorded',
    actor: normalizedActor,
    subject: { kind: 'denial_feedback', feedback_id: feedbackId, claim_ref: record.claim_ref },
    details: {
      predicted_denial_code: record.predicted_denial_code,
      reviewer_label: record.reviewer_label,
      learning_signal: record.learning_signal,
      reviewer_confirmed: record.reviewer_confirmed
    }
  });

  return { ok: true, status: 201, feedback: record, learning_stats: stats };
}

export function listDenialFeedback() {
  ensureSeeded();
  return listJson(FEEDBACK_DIR)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

export function ingestDenialArtifacts(input = {}, actor = {}) {
  ensureSeeded();
  const normalizedActor = normalizeActor(actor);
  const artifactsInput = Array.isArray(input.artifacts) ? input.artifacts : [];
  const practiceName = cleanString(input.practice_name) || 'Unknown practice';
  const practiceSlug = toFileSlug(practiceName, 'practice');
  const stats = readLearningStats();
  const artifacts = [];
  const worklistItems = [];

  for (const artifactInput of artifactsInput) {
    const parsed = ingestArtifactPayload(artifactInput);
    const normalizedRecords = parsed.parsed_records.map((record) => normalizeDenialRecord(record, parsed));
    const scoredItems = normalizedRecords.map((record) => {
      const score = scoreDenial({
        ...record,
        artifact_names: [parsed.name],
        claim_ref: record.claim_ref,
        amount_at_risk: record.amount_at_risk
      }, actor);
      return {
        claim_ref: record.claim_ref,
        payer: record.payer,
        patient: record.patient,
        cpt: record.cpt,
        dos: record.dos,
        amount_at_risk: record.amount_at_risk,
        source_artifact_id: parsed.artifact_id,
        source_artifact_name: parsed.name,
        artifact_type: parsed.artifact_type,
        highest_severity: score.primary_match?.severity || 'low',
        confidence: score.confidence,
        categories: score.matches.map((match) => match.denial_code),
        recommended_next_step: score.recommended_actions[0] || 'Queue for reviewer labeling.',
        route_to: score.route_to,
        score
      };
    });

    const artifactRecord = {
      artifact_id: parsed.artifact_id,
      practice_name: practiceName,
      practice_slug: practiceSlug,
      created_at: nowIso(),
      name: parsed.name,
      format: parsed.format,
      content_type: parsed.content_type,
      artifact_type: parsed.artifact_type,
      record_count: parsed.record_count,
      normalized_records: normalizedRecords,
      scored_items: scoredItems
    };
    writeJson(artifactFile(parsed.artifact_id), artifactRecord);
    artifacts.push(artifactRecord);
    worklistItems.push(...scoredItems);
    stats.totals.ingested_artifacts += 1;
    stats.totals.normalized_records += normalizedRecords.length;
    stats.artifact_types_seen[parsed.artifact_type] = (stats.artifact_types_seen[parsed.artifact_type] || 0) + 1;
  }

  worklistItems.sort((a, b) => {
    if (severityRank(b.highest_severity) !== severityRank(a.highest_severity)) return severityRank(b.highest_severity) - severityRank(a.highest_severity);
    if ((b.amount_at_risk || 0) !== (a.amount_at_risk || 0)) return (b.amount_at_risk || 0) - (a.amount_at_risk || 0);
    return (b.confidence || 0) - (a.confidence || 0);
  });

  const worklistId = makeId('worklist');
  const worklist = {
    worklist_id: worklistId,
    practice_name: practiceName,
    practice_slug: practiceSlug,
    created_at: nowIso(),
    source_artifact_ids: artifacts.map((item) => item.artifact_id),
    item_count: worklistItems.length,
    totals: {
      amount_at_risk: Number(worklistItems.reduce((sum, item) => sum + (item.amount_at_risk || 0), 0).toFixed(2)),
      critical_or_high: worklistItems.filter((item) => ['critical', 'high'].includes(item.highest_severity)).length
    },
    items: worklistItems
  };
  writeJson(worklistFile(worklistId), worklist);
  stats.totals.routed_worklist_items += worklistItems.length;
  stats.recent_worklists = [{
    worklist_id: worklist.worklist_id,
    practice_name: worklist.practice_name,
    created_at: worklist.created_at,
    item_count: worklist.item_count,
    amount_at_risk: worklist.totals.amount_at_risk
  }, ...(stats.recent_worklists || [])].slice(0, 10);
  writeLearningStats(stats);

  appendAuditEvent({
    type: 'denial.artifacts.ingested',
    actor: normalizedActor,
    subject: { kind: 'denial_worklist', worklist_id: worklistId, practice_slug: practiceSlug },
    details: {
      artifact_count: artifacts.length,
      worklist_item_count: worklist.item_count,
      practice_name: practiceName
    }
  });

  return {
    ok: true,
    status: 201,
    specialty: 'PMHNP',
    practice_name: practiceName,
    artifacts: artifacts.map((artifact) => ({
      artifact_id: artifact.artifact_id,
      name: artifact.name,
      artifact_type: artifact.artifact_type,
      record_count: artifact.record_count
    })),
    worklist,
    learning_stats: stats
  };
}

export function listDenialArtifacts() {
  ensureSeeded();
  return listJson(ARTIFACTS_DIR).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

export function listDenialWorklists() {
  ensureSeeded();
  return listJson(WORKLISTS_DIR).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}
