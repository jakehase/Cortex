import crypto from 'node:crypto';
import fs from 'node:fs';

export function sha256Text(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function sha256Bytes(value = Buffer.alloc(0)) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
