import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/orchestrator-real-repo-clean-plan.mjs';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--assignment') args.assignment = argv[index + 1];
    if (token === '--verifier') args.verifier = argv[index + 1];
  }
  return args;
}

function runCommand(command, args, { cwd = ROOT, env = process.env } = {}) {
  const startedAt = Date.now();
  try {
    const stdout = execFileSync(command, args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
    return {
      ok: true,
      command: [command, ...args].join(' '),
      durationMs: Date.now() - startedAt,
      stdout: String(stdout).trim(),
      stderr: ''
    };
  } catch (error) {
    return {
      ok: false,
      command: [command, ...args].join(' '),
      durationMs: Date.now() - startedAt,
      stdout: `${error.stdout || ''}`.trim(),
      stderr: `${error.stderr || ''}${error.message || ''}`.trim()
    };
  }
}

function loadAssignment(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function absolute(relativePath) {
  return path.join(ROOT, relativePath);
}

function normalizeFileList(assignment) {
  return [...new Set((assignment.shard.allowedFiles || [])
    .filter((entry) => /\.(mjs|js)$/.test(entry))
    .map((entry) => absolute(entry))
    .filter((entry) => fs.existsSync(entry)))];
}

async function verifyImports(assignment) {
  const importTargets = [assignment.shard.metadata?.importFile, ...(assignment.shard.metadata?.extraImportFiles || [])]
    .filter(Boolean)
    .map((entry) => absolute(entry));
  const report = [];
  for (const target of importTargets) {
    try {
      const module = await import(`${pathToFileURL(target).href}?ts=${Date.now()}`);
      report.push({ file: path.relative(ROOT, target), ok: true, exportCount: Object.keys(module).length });
    } catch (error) {
      report.push({ file: path.relative(ROOT, target), ok: false, error: error.message });
      return { ok: false, importTargets: report };
    }
  }
  return { ok: true, importTargets: report };
}

function verifyLint(assignment) {
  const files = normalizeFileList(assignment);
  const results = files.map((filePath) => ({ file: path.relative(ROOT, filePath), ...runCommand(process.execPath, ['--check', filePath], { cwd: ROOT }) }));
  return {
    ok: results.every((entry) => entry.ok),
    checkedFileCount: results.length,
    files: results
  };
}

function verifyTests(assignment) {
  const testFiles = [assignment.shard.metadata?.testFile, ...(assignment.shard.metadata?.extraTestFiles || [])]
    .filter(Boolean)
    .map((entry) => absolute(entry));
  if (testFiles.length === 0) {
    return {
      ok: false,
      testFileCount: 0,
      files: [],
      note: 'tests verifier requested but no shard test files were configured'
    };
  }
  const results = testFiles.map((testFile) => ({ file: path.relative(ROOT, testFile), ...runCommand(process.execPath, ['--test', '--test-concurrency=1', testFile], { cwd: ROOT }) }));
  return {
    ok: results.every((entry) => entry.ok),
    testFileCount: results.length,
    files: results
  };
}

function verifySmoke() {
  const result = runCommand(process.execPath, ['scripts/smoke-full-clone.mjs'], { cwd: ROOT });
  return {
    ok: result.ok,
    smoke: result
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.assignment || !args.verifier) {
  console.error('missing --assignment or --verifier');
  process.exit(1);
}

const assignment = loadAssignment(args.assignment);
let payload;
if (args.verifier === 'lint') payload = verifyLint(assignment);
else if (args.verifier === 'imports') payload = await verifyImports(assignment);
else if (args.verifier === 'tests') payload = verifyTests(assignment);
else if (args.verifier === 'smoke') payload = verifySmoke(assignment);
else {
  console.error(`unknown verifier ${args.verifier}`);
  process.exit(1);
}

console.log(JSON.stringify({ verifier: args.verifier, ...payload }, null, 2));
process.exit(payload.ok ? 0 : 2);
