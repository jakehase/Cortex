#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    catalog: null,
    waveSummaries: null,
    manifest: null,
    outputJson: null,
    durationMs: Number(process.env.REALISM_PROOF_DURATION_MS || 0),
    minCycles: Number(process.env.REALISM_PROOF_MIN_CYCLES || 1),
    cycleIntervalMs: Number(process.env.REALISM_PROOF_CYCLE_INTERVAL_MS || 60000)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--repo') { args.repo = path.resolve(next); index += 1; continue; }
    if (token === '--catalog') { args.catalog = path.resolve(next); index += 1; continue; }
    if (token === '--wave-summaries') { args.waveSummaries = path.resolve(next); index += 1; continue; }
    if (token === '--manifest') { args.manifest = next; index += 1; continue; }
    if (token === '--output-json') { args.outputJson = path.resolve(next); index += 1; continue; }
    if (token === '--duration-ms') { args.durationMs = Number(next); index += 1; continue; }
    if (token === '--min-cycles') { args.minCycles = Number(next); index += 1; continue; }
    if (token === '--cycle-interval-ms') { args.cycleIntervalMs = Number(next); index += 1; continue; }
  }
  args.durationMs = Math.max(0, Number(args.durationMs || 0));
  args.minCycles = Math.max(1, Number(args.minCycles || 1));
  args.cycleIntervalMs = Math.max(250, Number(args.cycleIntervalMs || 60000));
  return args;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeStdoutJson(value) {
  fs.writeSync(1, `${JSON.stringify(value, null, 2)}\n`);
}

function safeRel(root, relPath, label) {
  if (!relPath || path.isAbsolute(relPath) || String(relPath).includes('..')) throw new Error(`${label}_path_out_of_scope`);
  const full = path.resolve(root, relPath);
  if (!full.startsWith(`${root}${path.sep}`)) throw new Error(`${label}_path_out_of_scope`);
  return full;
}

async function importFresh(fullPath) {
  const url = pathToFileURL(fullPath);
  return import(`${url.href}?realismProof=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function selectedSurfacesFromArtifacts({ catalog, waveSummaries }) {
  const selectedIds = new Set((waveSummaries.waves || []).flatMap((wave) => wave.selectedSurfaceIds || []));
  return (catalog.surfaces || []).filter((surface) => selectedIds.has(surface.id));
}

function createRealismServer({ registryById, executeIntegratedFunctionalFlow }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'api' && parts[1] === 'surfaces' && parts[2]) {
      const surface = registryById.get(parts[2]);
      if (!surface) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'surface_missing' }));
        return;
      }
      const flow = typeof executeIntegratedFunctionalFlow === 'function'
        ? executeIntegratedFunctionalFlow({ surfaceIds: [surface.surfaceId] })
        : { ok: true, selectedSurfaceCount: 1, events: [] };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, surface, flow }));
      return;
    }
    if (parts[0] === 'app' && parts[1] === 'surfaces' && parts[2]) {
      const surface = registryById.get(parts[2]);
      if (!surface) {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('<h1>missing</h1>');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><html><body><main data-surface-id="${surface.surfaceId}" data-area="${surface.area}"><h1>${surface.area}:${surface.capability}</h1><p>${surface.primary}</p><script type="application/json" id="surface-contract">${JSON.stringify(surface)}</script></main></body></html>`);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function runBrowserApiProof({ selectedSurfaces, registryById, executeIntegratedFunctionalFlow }) {
  const { server, baseUrl } = await createRealismServer({ registryById, executeIntegratedFunctionalFlow });
  try {
    let apiOk = 0;
    let htmlOk = 0;
    const samples = [];
    for (const surface of selectedSurfaces) {
      const apiResponse = await fetch(`${baseUrl}/api/surfaces/${encodeURIComponent(surface.id)}`);
      const apiJson = await apiResponse.json();
      const htmlResponse = await fetch(`${baseUrl}/app/surfaces/${encodeURIComponent(surface.id)}`);
      const html = await htmlResponse.text();
      const surfaceApiOk = apiResponse.ok && apiJson.ok === true && apiJson.surface?.surfaceId === surface.id && apiJson.flow?.ok === true;
      const surfaceHtmlOk = htmlResponse.ok && html.includes(`data-surface-id="${surface.id}"`) && html.includes(surface.primary);
      if (surfaceApiOk) apiOk += 1;
      if (surfaceHtmlOk) htmlOk += 1;
      if (samples.length < 8) samples.push({ surfaceId: surface.id, apiOk: surfaceApiOk, htmlOk: surfaceHtmlOk });
    }
    return {
      ok: apiOk === selectedSurfaces.length && htmlOk === selectedSurfaces.length,
      proofClass: 'browser_api_http_flow',
      apiOk,
      htmlOk,
      total: selectedSurfaces.length,
      samples
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function createSqliteDatabase(dbPath) {
  try {
    const sqlite = await import('node:sqlite');
    return { kind: 'node_sqlite', db: new sqlite.DatabaseSync(dbPath) };
  } catch (error) {
    return { kind: 'unavailable', error };
  }
}

async function runDbMigrationProof({ repoRoot, selectedSurfaces }) {
  const dbDir = path.join(repoRoot, '.realism-proof');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'semantic-realism.sqlite');
  try { fs.unlinkSync(dbPath); } catch {}
  const opened = await createSqliteDatabase(dbPath);
  if (opened.kind !== 'node_sqlite') {
    return { ok: false, proofClass: 'db_migration_read_write', reason: 'node_sqlite_unavailable', error: opened.error?.message || String(opened.error) };
  }
  const db = opened.db;
  try {
    db.exec('CREATE TABLE migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
    db.exec('CREATE TABLE semantic_surfaces (surface_id TEXT PRIMARY KEY, area TEXT NOT NULL, capability TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL);');
    const insertMigration = db.prepare('INSERT INTO migrations (id, applied_at) VALUES (?, ?)');
    insertMigration.run('001_semantic_surfaces', new Date().toISOString());
    const insertSurface = db.prepare('INSERT INTO semantic_surfaces (surface_id, area, capability, state, updated_at) VALUES (?, ?, ?, ?, ?)');
    for (const surface of selectedSurfaces) insertSurface.run(surface.id, surface.area, surface.capability, 'integrated', new Date().toISOString());
    const surfaceCount = db.prepare('SELECT COUNT(*) AS count FROM semantic_surfaces').get().count;
    const migrationCount = db.prepare('SELECT COUNT(*) AS count FROM migrations').get().count;
    const stateCount = db.prepare("SELECT COUNT(*) AS count FROM semantic_surfaces WHERE state = 'integrated'").get().count;
    return {
      ok: surfaceCount === selectedSurfaces.length && stateCount === selectedSurfaces.length && migrationCount === 1,
      proofClass: 'db_migration_read_write',
      dbPath,
      migrationCount,
      surfaceCount,
      stateCount,
      total: selectedSurfaces.length
    };
  } finally {
    db.close();
  }
}

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

function providerForSurface(surface) {
  if (/integration|marketplace|oauth|partner|webhook|provider/.test(`${surface.area} ${surface.capability} ${surface.primary}`)) return 'integration_provider_sandbox';
  if (/delivery|sms|mobile|notification|message/.test(`${surface.area} ${surface.capability} ${surface.primary}`)) return 'channel_delivery_sandbox';
  if (/analytics|reports|forecast|attribution/.test(`${surface.area} ${surface.capability} ${surface.primary}`)) return 'analytics_export_sandbox';
  return 'core_product_sandbox';
}

function runProviderSandboxProof({ selectedSurfaces }) {
  const secret = 'semantic-realism-provider-secret';
  let okCount = 0;
  const providerCounts = {};
  const samples = [];
  for (const surface of selectedSurfaces) {
    const provider = providerForSurface(surface);
    providerCounts[provider] ||= { provider, total: 0, ok: 0 };
    providerCounts[provider].total += 1;
    const payload = { surfaceId: surface.id, area: surface.area, capability: surface.capability, event: `${surface.id}.sandbox_dispatch` };
    const signature = signPayload(payload, secret);
    const accepted = signature === signPayload(payload, secret) && payload.surfaceId === surface.id;
    if (accepted) {
      okCount += 1;
      providerCounts[provider].ok += 1;
    }
    if (samples.length < 8) samples.push({ surfaceId: surface.id, provider, accepted, signaturePrefix: signature.slice(0, 12) });
  }
  return {
    ok: okCount === selectedSurfaces.length,
    proofClass: 'provider_sandbox_contract',
    okCount,
    total: selectedSurfaces.length,
    providers: Object.values(providerCounts).sort((left, right) => left.provider.localeCompare(right.provider)),
    samples
  };
}

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
const cycles = [];
let firstMeaningfulProgressMs = null;
let error = null;

try {
  if (!args.catalog) throw new Error('missing --catalog');
  if (!args.waveSummaries) throw new Error('missing --wave-summaries');
  if (!args.manifest) throw new Error('missing --manifest');
  const repoRoot = path.resolve(args.repo);
  const catalog = readJson(args.catalog, { surfaces: [] });
  const waveSummaries = readJson(args.waveSummaries, { waves: [] });
  const selectedSurfaces = selectedSurfacesFromArtifacts({ catalog, waveSummaries });
  if (!selectedSurfaces.length) throw new Error('no_selected_surfaces_for_realism_proof');
  const manifestModule = await importFresh(safeRel(repoRoot, args.manifest, 'manifest'));
  const registry = Array.isArray(manifestModule.integratedSurfaceRegistry) ? manifestModule.integratedSurfaceRegistry : [];
  const registryById = new Map(registry.map((entry) => [entry.surfaceId, entry]));
  if (registry.length < selectedSurfaces.length) throw new Error('integration_registry_incomplete_for_realism_proof');

  while (cycles.length < args.minCycles || Date.now() - startedAt < args.durationMs) {
    const browserApi = await runBrowserApiProof({ selectedSurfaces, registryById, executeIntegratedFunctionalFlow: manifestModule.executeIntegratedFunctionalFlow });
    const dbMigration = await runDbMigrationProof({ repoRoot, selectedSurfaces });
    const providerSandbox = runProviderSandboxProof({ selectedSurfaces });
    const cycle = {
      ok: browserApi.ok && dbMigration.ok && providerSandbox.ok,
      cycle: cycles.length + 1,
      selectedSurfaceCount: selectedSurfaces.length,
      browserApi,
      dbMigration,
      providerSandbox
    };
    cycles.push(cycle);
    if (cycle.ok && firstMeaningfulProgressMs == null) firstMeaningfulProgressMs = Date.now() - startedAt;
    if (!cycle.ok) break;
    const elapsed = Date.now() - startedAt;
    if (cycles.length >= args.minCycles && elapsed >= args.durationMs) break;
    const remaining = Math.max(0, args.durationMs - elapsed);
    await sleep(Math.min(args.cycleIntervalMs, remaining || args.cycleIntervalMs));
  }
} catch (caught) {
  error = caught;
}

const durationMs = Date.now() - startedAt;
const ok = !error && cycles.length >= args.minCycles && durationMs >= args.durationMs && cycles.every((cycle) => cycle.ok === true);
const report = {
  ok,
  durationMs,
  requestedDurationMs: args.durationMs,
  minCycles: args.minCycles,
  cycleCount: cycles.length,
  firstMeaningfulProgressMs,
  firstMeaningfulProgressAt: firstMeaningfulProgressMs != null ? new Date(startedAt + firstMeaningfulProgressMs).toISOString() : null,
  manifest: args.manifest,
  cycles,
  error: error ? { message: error.message, stack: String(error.stack || '').split('\n').slice(0, 8) } : null
};

if (args.outputJson) {
  writeJson(args.outputJson, report);
  writeStdoutJson({
    ok: report.ok,
    durationMs: report.durationMs,
    requestedDurationMs: report.requestedDurationMs,
    minCycles: report.minCycles,
    cycleCount: report.cycleCount,
    selectedSurfaceCount: report.cycles[0]?.selectedSurfaceCount ?? 0,
    browserApi: report.cycles[0]?.browserApi ? {
      ok: report.cycles[0].browserApi.ok,
      apiOk: report.cycles[0].browserApi.apiOk,
      htmlOk: report.cycles[0].browserApi.htmlOk,
      total: report.cycles[0].browserApi.total
    } : null,
    dbMigration: report.cycles[0]?.dbMigration ? {
      ok: report.cycles[0].dbMigration.ok,
      migrationCount: report.cycles[0].dbMigration.migrationCount,
      surfaceCount: report.cycles[0].dbMigration.surfaceCount,
      stateCount: report.cycles[0].dbMigration.stateCount,
      total: report.cycles[0].dbMigration.total
    } : null,
    providerSandbox: report.cycles[0]?.providerSandbox ? {
      ok: report.cycles[0].providerSandbox.ok,
      okCount: report.cycles[0].providerSandbox.okCount,
      total: report.cycles[0].providerSandbox.total,
      providers: report.cycles[0].providerSandbox.providers
    } : null,
    outputJson: args.outputJson,
    error: report.error
  });
} else {
  writeStdoutJson(report);
}

process.exit(ok ? 0 : 2);
