#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    catalog: null,
    waveSummaries: null,
    manifest: null,
    outputJson: null,
    durationMs: Number(process.env.INTEGRATION_FUNCTIONAL_PROOF_DURATION_MS || 0),
    minCycles: Number(process.env.INTEGRATION_FUNCTIONAL_PROOF_MIN_CYCLES || 1),
    cycleIntervalMs: Number(process.env.INTEGRATION_FUNCTIONAL_PROOF_CYCLE_INTERVAL_MS || 60000)
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
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function importFresh(fullPath) {
  const url = pathToFileURL(fullPath);
  return import(`${url.href}?integrationProof=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function proofClassForSurface(surface = {}) {
  if (surface.acceptanceClass === 'ui_route_runtime' || String(surface.primary || '').startsWith('apps/web/routes/')) return 'ui_route_flow';
  if (/journey|delivery|scheduling|jobs|automation|orchestration/.test(`${surface.area} ${surface.capability} ${surface.primary}`)) return 'job_event_flow';
  if (/integration|marketplace|webhook|oauth|partner|provider/.test(`${surface.area} ${surface.capability} ${surface.primary}`)) return 'integration_provider_flow';
  if (/security|privacy|billing|policy|permission|sso|compliance/.test(`${surface.area} ${surface.capability} ${surface.primary}`)) return 'security_policy_flow';
  if (/analytics|reports|forecast|attribution|observability/.test(`${surface.area} ${surface.capability} ${surface.primary}`)) return 'analytics_telemetry_flow';
  return 'domain_api_flow';
}

function assertSemanticSource(source, surfaceId, relFile) {
  const text = String(source || '');
  if (text.includes('transferBenchmarkEvidence_')) throw new Error(`marker_export_present:${relFile}`);
  if (!text.includes(surfaceId)) throw new Error(`surface_id_missing:${relFile}`);
  return /semanticProductArchitectureRuntime_/.test(text) && /semanticProductArchitectureContract_/.test(text);
}

function moduleEntries(module, prefix, surfaceId) {
  return Object.entries(module).filter(([name, value]) => name.startsWith(prefix) && (prefix.endsWith('Runtime_') ? typeof value === 'function' : value?.surfaceId === surfaceId));
}

async function verifySurface({ repoRoot, surface, registryById, cycle }) {
  const primaryPath = safeRel(repoRoot, surface.primary, 'primary');
  const companionPath = safeRel(repoRoot, surface.companion, 'companion');
  const primarySource = fs.readFileSync(primaryPath, 'utf8');
  const companionSource = fs.readFileSync(companionPath, 'utf8');
  const primaryHasRuntime = assertSemanticSource(primarySource, surface.id, surface.primary);
  const companionHasRuntime = assertSemanticSource(companionSource, surface.id, surface.companion);
  if (!primaryHasRuntime && !companionHasRuntime) throw new Error(`semantic_runtime_missing:${surface.id}`);

  const modules = [await importFresh(primaryPath), await importFresh(companionPath)];
  const runtimeEntries = modules.flatMap((module) => Object.entries(module).filter(([name, value]) => name.startsWith('semanticProductArchitectureRuntime_') && typeof value === 'function'));
  const contractEntries = modules.flatMap((module) => Object.entries(module).filter(([name, value]) => name.startsWith('semanticProductArchitectureContract_') && value?.surfaceId === surface.id));
  if (!runtimeEntries.length) throw new Error(`runtime_export_missing:${surface.id}`);
  if (!contractEntries.length) throw new Error(`contract_export_missing:${surface.id}`);

  const registryEntry = registryById.get(surface.id);
  if (!registryEntry) throw new Error(`integration_registry_missing:${surface.id}`);
  if (registryEntry.primary !== surface.primary || registryEntry.companion !== surface.companion) throw new Error(`integration_registry_file_mismatch:${surface.id}`);

  const storeWrites = [];
  const runtimeResults = runtimeEntries.map(([name, fn], index) => {
    const result = fn({
      entityId: `${surface.id}-functional-${cycle}-${index + 1}`,
      state: 'integrated',
      actorId: 'functional-proof-pack'
    }, {
      now: new Date().toISOString(),
      actorId: 'functional-proof-pack',
      events: [{ type: `${surface.id}.functional_baseline`, surfaceId: surface.id }],
      store: {
        save(record) {
          const saved = { ...record, saved: true, integrationRegistryVersion: registryEntry.registryVersion || null };
          storeWrites.push(saved);
          return saved;
        }
      }
    });
    return { name, result };
  });

  const ok = runtimeResults.every(({ result }) => result?.ok === true
    && result.surfaceId === surface.id
    && result.persisted?.saved === true
    && Array.isArray(result.events)
    && result.events.some((event) => event.type === `${surface.id}.state_transition`)
    && result.telemetry?.integrationPointCount >= 2)
    && storeWrites.length >= runtimeResults.length;

  return {
    ok,
    surfaceId: surface.id,
    proofClass: proofClassForSurface(surface),
    primary: surface.primary,
    companion: surface.companion,
    runtimeExportCount: runtimeEntries.length,
    contractExportCount: contractEntries.length,
    storeWriteCount: storeWrites.length,
    registryEntry,
    runtimeResults: runtimeResults.map(({ name, result }) => ({ name, ok: result?.ok === true, eventCount: Array.isArray(result?.events) ? result.events.length : 0, telemetry: result?.telemetry || null }))
  };
}

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
let error = null;
const cycles = [];
let firstMeaningfulProgressMs = null;

try {
  if (!args.catalog) throw new Error('missing --catalog');
  if (!args.waveSummaries) throw new Error('missing --wave-summaries');
  if (!args.manifest) throw new Error('missing --manifest');
  const repoRoot = path.resolve(args.repo);
  const catalog = readJson(args.catalog, { surfaces: [] });
  const waveSummaries = readJson(args.waveSummaries, { waves: [] });
  const manifestRel = args.manifest;
  const manifestFull = safeRel(repoRoot, manifestRel, 'manifest');
  if (!fs.existsSync(manifestFull)) throw new Error('integration_manifest_missing');
  const manifestModule = await importFresh(manifestFull);
  const registry = Array.isArray(manifestModule.integratedSurfaceRegistry) ? manifestModule.integratedSurfaceRegistry : [];
  const registryById = new Map(registry.map((entry) => [entry.surfaceId, entry]));
  const selectedIds = new Set((waveSummaries.waves || []).flatMap((wave) => wave.selectedSurfaceIds || []));
  const selectedSurfaces = (catalog.surfaces || []).filter((surface) => selectedIds.has(surface.id));
  if (!selectedSurfaces.length) throw new Error('no_selected_surfaces_for_functional_proof');
  if (registry.length < selectedSurfaces.length) throw new Error('integration_registry_incomplete');

  while (cycles.length < args.minCycles || Date.now() - startedAt < args.durationMs) {
    const surfaceResults = [];
    for (const surface of selectedSurfaces) {
      surfaceResults.push(await verifySurface({ repoRoot, surface, registryById, cycle: cycles.length + 1 }));
    }
    const byClass = {};
    for (const result of surfaceResults) {
      byClass[result.proofClass] ||= { proofClass: result.proofClass, total: 0, ok: 0, failed: 0 };
      byClass[result.proofClass].total += 1;
      if (result.ok) byClass[result.proofClass].ok += 1;
      else byClass[result.proofClass].failed += 1;
    }
    const cycle = {
      ok: surfaceResults.every((result) => result.ok === true),
      cycle: cycles.length + 1,
      selectedSurfaceCount: selectedSurfaces.length,
      registrySurfaceCount: registry.length,
      proofClasses: Object.values(byClass).sort((left, right) => left.proofClass.localeCompare(right.proofClass)),
      surfaceResults: surfaceResults.map((result) => ({
        ok: result.ok,
        surfaceId: result.surfaceId,
        proofClass: result.proofClass,
        primary: result.primary,
        companion: result.companion,
        runtimeExportCount: result.runtimeExportCount,
        contractExportCount: result.contractExportCount,
        storeWriteCount: result.storeWriteCount,
        registryVersion: result.registryEntry?.registryVersion || null,
        telemetry: result.runtimeResults?.[0]?.telemetry || null
      }))
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
    registrySurfaceCount: report.cycles[0]?.registrySurfaceCount ?? 0,
    proofClasses: report.cycles[0]?.proofClasses ?? [],
    outputJson: args.outputJson,
    error: report.error
  });
} else {
  writeStdoutJson(report);
}

process.exit(ok ? 0 : 2);
