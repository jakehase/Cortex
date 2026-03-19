#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const registryPath = '/root/clawd/state/cortex-capabilities.json';
const selftestPath = '/root/clawd/scripts/cortex-upgrade-selftest.mjs';

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function scoreCapability(query, cap) {
  const hay = normalize([cap.id, cap.name, cap.category, ...(cap.blockers || []), ...(cap.codePaths || [])].join(' '));
  const q = normalize(query).split(' ').filter(Boolean);
  let score = 0;
  for (const token of q) if (hay.includes(token)) score += 1;
  return score;
}
function summarize(cap) {
  return {
    id: cap.id,
    name: cap.name,
    category: cap.category,
    implemented: cap.implemented,
    live: cap.live,
    verified: cap.verified,
    blockers: cap.blockers || [],
    codePaths: cap.codePaths || []
  };
}

const args = process.argv.slice(2);
const query = args.join(' ').trim();
const registry = loadJson(registryPath);
registry.generatedAt = new Date().toISOString();
fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));

let matches = registry.capabilities;
if (query) {
  matches = [...registry.capabilities]
    .map((cap) => ({ cap, score: scoreCapability(query, cap) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.cap);
}

const overlapping = matches.filter((c) => c.implemented);
const incomplete = matches.filter((c) => c.implemented && (!c.live || !c.verified || (c.blockers || []).length));
const recommendation = query
  ? (matches.length
      ? `Before changing '${query}', review overlapping capabilities first.`
      : `No overlapping registered capability found for '${query}'. Safe to scope a new upgrade, but verify manually.`)
  : 'No query supplied. Listing all registered capabilities.';

console.log(JSON.stringify({
  query: query || null,
  recommendation,
  overlapping: overlapping.map(summarize),
  incomplete: incomplete.map(summarize),
  registryPath,
  selftestPath
}, null, 2));
