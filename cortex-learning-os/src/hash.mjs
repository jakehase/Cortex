import crypto from 'node:crypto';
import fs from 'node:fs';

export function sha256Text(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
