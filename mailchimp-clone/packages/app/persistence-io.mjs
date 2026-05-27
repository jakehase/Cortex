import fs from 'node:fs';

export function writeJsonAtomic(filePath, body) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(body, null, 2));
  fs.renameSync(tempPath, filePath);
}

export function writeTextFile(filePath, body) {
  fs.writeFileSync(filePath, body || '', 'utf8');
}

export function writeJsonFile(filePath, body) {
  fs.writeFileSync(filePath, JSON.stringify(body, null, 2));
}
