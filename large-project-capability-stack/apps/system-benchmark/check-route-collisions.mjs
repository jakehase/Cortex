#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function normalizeRoute(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  const match = text.match(/^([A-Za-z]+)\s+(.+)$/);
  if (!match) return text;
  return `${match[1].toUpperCase()} ${match[2].trim()}`;
}

function parseArgs(argv) {
  const args = { repoPath: process.cwd(), maxRouteCollisions: 0, out: null, routes: [], requireRoutesPresent: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--repo-path') { args.repoPath = path.resolve(next); index += 1; continue; }
    if (token === '--max-route-collisions') { args.maxRouteCollisions = Number(next); index += 1; continue; }
    if (token === '--route' || token === '--only-route') { args.routes.push(normalizeRoute(next)); index += 1; continue; }
    if (token === '--routes' || token === '--only-routes') { args.routes.push(...String(next || '').split(',').map(normalizeRoute).filter(Boolean)); index += 1; continue; }
    if (token === '--require-routes-present') { args.requireRoutesPresent = true; continue; }
    if (token === '--out') { args.out = path.resolve(next); index += 1; continue; }
  }
  args.routes = [...new Set(args.routes.map(normalizeRoute).filter(Boolean))];
  args.maxRouteCollisions = Number.isFinite(args.maxRouteCollisions) ? args.maxRouteCollisions : 0;
  return args;
}

function listSourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'artifacts') continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replaceAll('\\', '/');
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/^(apps|packages)\//.test(rel)) continue;
      if (/(^|\/)tests?\//.test(rel)) continue;
      if (/\.(?:mjs|js|jsx|ts|tsx)$/.test(entry.name)) out.push({ full, rel });
    }
  };
  walk(root);
  return out;
}

function auditRouteCollisions(repoPath, { routes = [], requireRoutesPresent = false } = {}) {
  const routeMap = new Map();
  const routeRe = /router\.register\(\s*['"]([A-Z]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
  for (const file of listSourceFiles(repoPath)) {
    const text = fs.readFileSync(file.full, 'utf8');
    let match;
    while ((match = routeRe.exec(text))) {
      const key = normalizeRoute(`${match[1]} ${match[2]}`);
      const entries = routeMap.get(key) || [];
      entries.push({ file: file.rel, offset: match.index });
      routeMap.set(key, entries);
    }
  }
  const allDuplicateRoutes = [...routeMap.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([route, entries]) => ({ route, count: entries.length, entries }))
    .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route));
  const scopedRouteSet = new Set(routes.map(normalizeRoute));
  const duplicateRoutes = scopedRouteSet.size
    ? allDuplicateRoutes.filter((entry) => scopedRouteSet.has(normalizeRoute(entry.route)))
    : allDuplicateRoutes;
  const missingRoutes = requireRoutesPresent
    ? [...scopedRouteSet].filter((route) => !routeMap.has(route))
    : [];
  return {
    routeCount: routeMap.size,
    routeScope: [...scopedRouteSet],
    duplicateRouteCount: allDuplicateRoutes.length,
    globalRouteCollisionCount: allDuplicateRoutes.length,
    routeCollisionCount: duplicateRoutes.length,
    missingRouteCount: missingRoutes.length,
    missingRoutes,
    duplicateRoutes,
    allDuplicateRoutes
  };
}

const args = parseArgs(process.argv.slice(2));
const routeAudit = auditRouteCollisions(args.repoPath, { routes: args.routes, requireRoutesPresent: args.requireRoutesPresent });
const collisionOk = routeAudit.routeCollisionCount <= args.maxRouteCollisions;
const missingOk = routeAudit.missingRouteCount === 0;
const ok = collisionOk && missingOk;
const failures = [];
if (!collisionOk) failures.push({ metric: 'routeCollisionCount', actual: routeAudit.routeCollisionCount, requirement: `<= ${args.maxRouteCollisions}`, reason: 'route_collision_detected' });
if (!missingOk) failures.push({ metric: 'missingRouteCount', actual: routeAudit.missingRouteCount, requirement: '= 0', reason: 'required_route_missing', routes: routeAudit.missingRoutes });
const report = {
  generatedAt: new Date().toISOString(),
  ok,
  repoPath: args.repoPath,
  routeAudit,
  metrics: {
    routeCollisionCount: routeAudit.routeCollisionCount,
    globalRouteCollisionCount: routeAudit.globalRouteCollisionCount,
    missingRouteCount: routeAudit.missingRouteCount
  },
  policy: { maxRouteCollisions: args.maxRouteCollisions, routes: args.routes, requireRoutesPresent: args.requireRoutesPresent },
  failures
};
if (args.out) {
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 1);
