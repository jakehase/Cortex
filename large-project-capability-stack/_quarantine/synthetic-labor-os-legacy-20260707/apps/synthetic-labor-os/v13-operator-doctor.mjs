#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUMMARY_SCHEMA = 'claw.synthetic_labor_os.v13.operator_doctor_summary';
const REPORT_SCHEMA = 'claw.synthetic_labor_os.v13.operator_doctor_report';

function parseArgs(argv) {
  const args = {
    artifactRoot: 'artifacts/synthetic-labor-os-v13/latest',
    repoRoot: process.cwd(),
    configPath: null,
    v11SummaryPath: 'artifacts/synthetic-labor-os-v11/latest/v11_release_bundle_summary.json',
    v12SummaryPath: 'artifacts/synthetic-labor-os-v12/latest/v12_fresh_replay_summary.json'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--artifact-root') { args.artifactRoot = next; index += 1; continue; }
    if (token === '--repo-root') { args.repoRoot = next; index += 1; continue; }
    if (token === '--config') { args.configPath = next; index += 1; continue; }
    if (token === '--v11-summary') { args.v11SummaryPath = next; index += 1; continue; }
    if (token === '--v12-summary') { args.v12SummaryPath = next; index += 1; continue; }
    if (token === '--help' || token === '-h') {
      console.log('usage: node apps/synthetic-labor-os/v13-operator-doctor.mjs [--artifact-root ROOT] [--config CONFIG]');
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function existsFile(filePath) {
  try { return fs.existsSync(filePath) && fs.statSync(filePath).isFile(); } catch { return false; }
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Synthetic Labor OS v13 Operator Doctor');
  lines.push('');
  lines.push(`Status: ${report.ok ? 'green' : 'blocked'}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Checks');
  for (const check of report.checks) {
    lines.push(`- ${check.ok ? '✅' : '❌'} ${check.id}: ${check.message}`);
  }
  lines.push('');
  lines.push('## Operator commands');
  for (const command of report.operatorCommands) lines.push(`- \`${command}\``);
  lines.push('');
  lines.push(`Truth boundary: ${report.truthBoundary}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function addCheck(checks, id, ok, message, details = {}) {
  checks.push({ id, ok, message, details });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const repoRoot = path.resolve(args.repoRoot);
  const artifactRoot = path.resolve(args.artifactRoot);
  const packagePath = path.join(repoRoot, 'package.json');
  const pkg = readJson(packagePath, null);
  const configPath = args.configPath ? path.resolve(args.configPath) : path.join(artifactRoot, 'operator_config.default.json');
  const defaultConfig = {
    schemaVersion: 'claw.synthetic_labor_os.v13.operator_config',
    repoRoot,
    artifactRoot,
    remoteHost: process.env.SYNTHETIC_LABOR_OS_REMOTE_HOST || 'jake@37.27.129.239',
    remoteRepoPath: process.env.SYNTHETIC_LABOR_OS_REMOTE_REPO || '/home/jake/clawd-remote/large-project-capability-stack',
    defaultFreshReplayTargetPrefix: 'docs/SYNTHETIC_LABOR_OS_V12_FRESH_REPLAY_',
    prohibitedActions: ['merge', 'publish', 'deploy', 'external_send'],
    truthBoundary: 'Operator config is local SLOS runtime metadata; it does not authorize external writes or publication.'
  };
  if (!args.configPath) writeJson(configPath, defaultConfig);
  const config = readJson(configPath, null);
  const v11SummaryPath = path.resolve(args.v11SummaryPath);
  const v12SummaryPath = path.resolve(args.v12SummaryPath);
  const v11 = readJson(v11SummaryPath, null);
  const v12 = readJson(v12SummaryPath, null);

  const checks = [];
  addCheck(checks, 'package_json_present', Boolean(pkg?.scripts), 'package.json with scripts is readable', { packagePath });
  const requiredScripts = [
    'ops:synthetic-labor-os:v10-scale-smoke',
    'ops:synthetic-labor-os:v11-release-bundle',
    'ops:synthetic-labor-os:v12-fresh-replay',
    'ops:synthetic-labor-os:v13-operator-doctor'
  ];
  for (const script of requiredScripts) addCheck(checks, `script:${script}`, Boolean(pkg?.scripts?.[script]), `npm script ${script} is present`);
  addCheck(checks, 'config_readable', Boolean(config?.schemaVersion), 'operator config is readable', { configPath });
  addCheck(checks, 'config_repo_root_matches', path.resolve(config?.repoRoot || repoRoot) === repoRoot, 'operator config repoRoot matches selected repo root', { configured: config?.repoRoot, repoRoot });
  addCheck(checks, 'config_remote_host_present', Boolean(String(config?.remoteHost || '').trim()), 'remoteHost is configured for fresh replay runs', { remoteHost: config?.remoteHost || null });
  addCheck(checks, 'v11_bundle_green', v11?.ok === true, 'latest v11 release bundle is green', { v11SummaryPath, status: v11?.status || null });
  addCheck(checks, 'v12_fresh_replay_green', v12?.ok === true, 'latest v12 fresh replay is green', { v12SummaryPath, status: v12?.status || null, target: v12?.target || null });
  addCheck(checks, 'v12_target_exists', v12?.freshTargetExists === true && existsFile(path.join(repoRoot, v12?.target || '')), 'v12 fresh replay target exists in the worktree', { target: v12?.target || null });
  addCheck(checks, 'v12_chain_green', Boolean(v12?.chainPath && existsFile(v12.chainPath)), 'v12 provenance chain artifact exists', { chainPath: v12?.chainPath || null });

  const failures = checks.filter((check) => !check.ok).map((check) => check.id);
  const ok = failures.length === 0;
  const operatorCommands = [
    'npm run ops:synthetic-labor-os:v12-fresh-replay',
    'npm run ops:synthetic-labor-os:v13-operator-doctor',
    'npm run ops:synthetic-labor-os:v14-multi-job-smoke',
    'npm run ops:synthetic-labor-os:v15-release-candidate'
  ];
  const report = {
    schemaVersion: REPORT_SCHEMA,
    generatedAt,
    ok,
    status: ok ? 'green_operator_doctor' : 'blocked',
    repoRoot,
    configPath,
    checks,
    operatorCommands,
    failures,
    blocker: ok ? null : { blockerKind: 'v13_operator_doctor_failed', blocker: `v13 operator doctor failed: ${failures.join(', ')}` },
    truthBoundary: ok
      ? 'v13 proves the local operator UX/config surface can find the required scripts and latest green v11/v12 evidence. It does not merge, publish, deploy, or send externally.'
      : 'v13 is blocked; do not call the operator UX ready until required scripts/config/evidence are green.'
  };
  const reportPath = writeJson(path.join(artifactRoot, 'v13_operator_doctor_report.json'), report);
  const markdownPath = path.join(artifactRoot, 'v13_operator_doctor_report.md');
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  const summary = {
    schemaVersion: SUMMARY_SCHEMA,
    generatedAt,
    ok,
    status: report.status,
    reportPath,
    markdownPath,
    configPath,
    checkCount: checks.length,
    greenCheckCount: checks.filter((check) => check.ok).length,
    blocker: report.blocker,
    truthBoundary: report.truthBoundary
  };
  const summaryPath = writeJson(path.join(artifactRoot, 'v13_operator_doctor_summary.json'), summary);
  console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
  if (!ok) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
