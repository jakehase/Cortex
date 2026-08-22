#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const includeEvidence = args.has('--include-evidence');
const strict = args.has('--strict');
const json = args.has('--json');
const verbose = args.has('--verbose');

const planIndexRel = 'docs/PLAN_INDEX.md';
const skipDirsAlways = new Set(['.git', 'node_modules']);
const evidenceDirNames = new Set(['artifacts']);
const historicalTopDirs = ['_quarantine', '_backups', '.cortex-export'];
const maxFindingsPerBucket = 50;

function relFromAbs(absPath) {
  return path.relative(root, absPath).split(path.sep).join('/');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function isMarkdownPlanLike(rel) {
  const base = path.basename(rel).toLowerCase();
  if (!base.endsWith('.md')) return false;
  const stem = base.slice(0, -3);
  const tokens = stem.split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.includes('plan') || tokens.includes('planning') || tokens.includes('roadmap');
}

function isIgnoredPlanningStandard(rel) {
  return [
    'docs/PROJECT_PLANNING.md',
    'docs/PROJECT_PLAN_TEMPLATE.md',
    'docs/PROJECT_STATUS_TEMPLATE.md',
    'docs/PROJECT_DECISIONS_TEMPLATE.md',
    'docs/PLAN_INDEX.md'
  ].includes(rel) || rel.startsWith('docs/project-plan-template-tournament/');
}

function isEvidenceOnly(rel) {
  return rel.startsWith('artifacts/')
    || rel.includes('/artifacts/')
    || rel.includes('/repo_baseline/')
    || rel.includes('/repo_preflight/')
    || rel.includes('/returned_artifacts/workspace/')
    || rel.includes('/reports/recovery-plan.md')
    || rel.includes('/reports/rollback-plan.md');
}

function isHistorical(rel) {
  return historicalTopDirs.some(prefix => rel === prefix || rel.startsWith(`${prefix}/`))
    || rel.startsWith('_rerun_')
    || rel.startsWith('_staging/')
    || rel === 'ai-os/plan.freeform-20260630-before-template.md'
    || rel.startsWith('large-project-capability-stack/docs/')
    || rel.startsWith('public/docs/')
    || rel.startsWith('public/cortex_server/docs/')
    || rel.startsWith('pmhnp-denial-copilot/docs/recovery/')
    || rel.startsWith('mailchimp-clone/docs/')
    || rel.startsWith('docs/cortex_roadmap/')
    || rel.startsWith('memory/')
    || rel === 'pmhnpbilling-site/design/redesign-plan.md'
    || /^docs\/.*(?:19|20)\d{2}[-_]?\d{2}[-_]?\d{2}.*plan.*\.md$/i.test(rel)
    || /^docs\/.*PLAN_(?:19|20)\d{2}[-_]?\d{2}[-_]?\d{2}\.md$/i.test(rel)
    || /^docs\/.*_PLAN_(?:19|20)\d{2}[-_]?\d{2}[-_]?\d{2}\.md$/i.test(rel)
    || /^docs\/.*_PLAN_\d{4}-\d{2}-\d{2}\.md$/i.test(rel)
    || /^docs\/.*_PLAN_\d{4}-\d{2}-\d{2}\.md$/i.test(rel);
}

function walk(dirAbs, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dirAbs, entry.name);
    const rel = relFromAbs(abs);
    if (entry.isDirectory()) {
      if (skipDirsAlways.has(entry.name)) continue;
      if (!includeEvidence && evidenceDirNames.has(entry.name)) continue;
      if (!includeEvidence && (entry.name.startsWith('_rerun_') || ['_quarantine', '_backups', '.cortex-export'].includes(entry.name))) continue;
      walk(abs, out);
    } else if (entry.isFile() && isMarkdownPlanLike(rel)) {
      out.push(rel);
    }
  }
  return out;
}

function extractBacktickPaths(markdown) {
  const paths = new Set();
  const regex = /`([^`]+\.md)`/g;
  let match;
  while ((match = regex.exec(markdown))) {
    let value = match[1].trim();
    if (value.startsWith('/root/clawd/')) value = value.slice('/root/clawd/'.length);
    if (!value.startsWith('/') && !value.includes('<') && !value.includes('*')) paths.add(value);
  }
  return paths;
}

function extractActiveRows(markdown) {
  const rows = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue;
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.length < 4 || cells[0] === 'Project') continue;
    const mdPaths = [...cells.join(' ').matchAll(/`([^`]+\.md)`/g)].map(m => {
      let value = m[1];
      if (value.startsWith('/root/clawd/')) value = value.slice('/root/clawd/'.length);
      return value;
    });
    if (mdPaths.length > 0) rows.push({ project: cells[0], cells, mdPaths });
  }
  return rows;
}

function lineHas(markdown, needles) {
  const lower = markdown.toLowerCase();
  return needles.some(needle => lower.includes(needle.toLowerCase()));
}

function checkActivePlan(rel, findings) {
  if (!exists(rel)) {
    findings.errors.push({ type: 'missing_active_plan', path: rel, message: 'Indexed canonical plan is missing.' });
    return;
  }
  const body = read(rel);
  if (!lineHas(body, ['Last updated:'])) findings.warnings.push({ type: 'missing_last_updated', path: rel, message: 'Active plan has no Last updated metadata.' });
  if (!lineHas(body, ['Primary stop condition', 'Stop condition'])) findings.errors.push({ type: 'missing_stop_condition', path: rel, message: 'Active plan has no stop condition.' });
  if (!lineHas(body, ['Immediate next milestone', 'Current milestone', 'Next actions', 'next milestone'])) findings.warnings.push({ type: 'missing_current_milestone', path: rel, message: 'Active plan has no obvious immediate/current milestone.' });
  if (body.includes('<project-slug>') || body.includes('<objective>') || body.includes('<path/to/')) findings.warnings.push({ type: 'template_placeholders', path: rel, message: 'Active plan appears to contain template placeholders.' });
  const dir = path.dirname(rel);
  const statusRel = path.join(dir, 'STATUS.md').split(path.sep).join('/');
  const decisionsRel = path.join(dir, 'DECISIONS.md').split(path.sep).join('/');
  if (!exists(statusRel)) findings.errors.push({ type: 'missing_status', path: statusRel, message: `Missing companion STATUS.md for ${rel}.` });
  if (!exists(decisionsRel)) findings.errors.push({ type: 'missing_decisions', path: decisionsRel, message: `Missing companion DECISIONS.md for ${rel}.` });
}

function checkStatusAndDecisions(rel, findings) {
  const dir = path.dirname(rel);
  const statusRel = path.join(dir, 'STATUS.md').split(path.sep).join('/');
  const decisionsRel = path.join(dir, 'DECISIONS.md').split(path.sep).join('/');
  if (exists(statusRel)) {
    const body = read(statusRel);
    for (const required of ['Current checkpoint', 'Active blockers', 'Next actions', 'Truth boundary']) {
      if (!body.includes(required)) findings.warnings.push({ type: 'status_missing_section', path: statusRel, message: `STATUS.md missing section: ${required}` });
    }
  }
  if (exists(decisionsRel)) {
    const body = read(decisionsRel);
    if (!body.includes('## Decisions')) findings.warnings.push({ type: 'decisions_missing_log', path: decisionsRel, message: 'DECISIONS.md missing Decisions section.' });
    const dated = [...body.matchAll(/^## \d{4}-\d{2}-\d{2} /gm)].length;
    if (dated === 0) findings.warnings.push({ type: 'decisions_no_entries', path: decisionsRel, message: 'DECISIONS.md has no dated decision entries.' });
  }
}

function pushLimited(bucket, finding) {
  if (bucket.length < maxFindingsPerBucket) bucket.push(finding);
}

const findings = { errors: [], warnings: [], evidenceOnly: [], historical: [], ok: [] };

if (!exists(planIndexRel)) {
  findings.errors.push({ type: 'missing_plan_index', path: planIndexRel, message: 'docs/PLAN_INDEX.md is missing.' });
} else {
  const index = read(planIndexRel);
  const indexedPaths = extractBacktickPaths(index);
  const rows = extractActiveRows(index);
  const canonicalPlans = rows.flatMap(row => row.mdPaths).filter(p => p.endsWith('/plan.md') || p === 'plan.md');

  if (!lineHas(index, ['Status file', 'Decisions log', 'Latest verified', 'Current milestone'])) {
    findings.warnings.push({ type: 'index_missing_lifecycle_columns', path: planIndexRel, message: 'PLAN_INDEX should include status, companion files, latest verified state, and current milestone.' });
  }

  for (const plan of canonicalPlans) {
    checkActivePlan(plan, findings);
    checkStatusAndDecisions(plan, findings);
  }

  const planLike = walk(root).sort();
  for (const rel of planLike) {
    if (isIgnoredPlanningStandard(rel)) continue;
    if (indexedPaths.has(rel)) {
      findings.ok.push({ type: 'indexed_plan', path: rel, message: 'Indexed plan-like file.' });
      continue;
    }
    if (isEvidenceOnly(rel)) {
      pushLimited(findings.evidenceOnly, { type: 'evidence_only_plan_like', path: rel, message: 'Plan-like file under artifact/evidence path; not active roadmap.' });
      continue;
    }
    if (isHistorical(rel)) {
      pushLimited(findings.historical, { type: 'historical_plan_like', path: rel, message: 'Plan-like file under historical/superseded path or dated docs plan.' });
      continue;
    }
    findings.warnings.push({ type: 'unindexed_plan_like', path: rel, message: 'Plan-like markdown file is not indexed or classified.' });
  }
}

const summary = {
  ok: findings.errors.length === 0 && (!strict || findings.warnings.length === 0),
  strict,
  includeEvidence,
  counts: {
    errors: findings.errors.length,
    warnings: findings.warnings.length,
    indexed: findings.ok.length,
    evidenceOnlySampled: findings.evidenceOnly.length,
    historicalSampled: findings.historical.length
  },
  findings
};

if (json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`plan-doctor: ${summary.ok ? 'ok' : 'issues_found'} errors=${summary.counts.errors} warnings=${summary.counts.warnings} indexed=${summary.counts.indexed}`);
  const visibleBuckets = [['ERROR', findings.errors], ['WARN', findings.warnings]];
  if (verbose || includeEvidence) {
    visibleBuckets.push(['EVIDENCE', findings.evidenceOnly], ['HISTORICAL', findings.historical]);
  }
  for (const [label, bucket] of visibleBuckets) {
    for (const item of bucket.slice(0, maxFindingsPerBucket)) {
      console.log(`${label} ${item.type}: ${item.path} — ${item.message}`);
    }
    if (bucket.length > maxFindingsPerBucket) console.log(`${label} ... ${bucket.length - maxFindingsPerBucket} more`);
  }
  if (!verbose && !includeEvidence && (findings.evidenceOnly.length > 0 || findings.historical.length > 0)) {
    console.log(`classified_non_active=${findings.evidenceOnly.length + findings.historical.length} (use --verbose or --include-evidence to list)`);
  }
}

process.exit(summary.ok ? 0 : 1);
