import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function listJson(dirPath) {
  ensureDir(dirPath);
  return fs.readdirSync(dirPath)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(path.join(dirPath, name), null))
    .filter(Boolean);
}

export function appendNdjson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

export function readNdjson(filePath, { limit } = {}) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    if (typeof limit === 'number' && limit >= 0) {
      return lines.slice(Math.max(0, lines.length - limit));
    }
    return lines;
  } catch {
    return [];
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function toFileSlug(value, fallback = 'record') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
