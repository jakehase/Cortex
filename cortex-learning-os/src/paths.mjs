import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLOS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function safeRelativePath(value = '') {
  const normalized = String(value || '').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error(`unsafe relative path: ${value}`);
  }
  return normalized.split(/[\\/]+/).join('/');
}

export function artifactPath(runId, relPath) {
  return path.join(CLOS_ROOT, 'artifacts', safeRelativePath(runId), safeRelativePath(relPath));
}
