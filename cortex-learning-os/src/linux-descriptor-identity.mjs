import fs from 'node:fs';

const MAX_FDINFO_BYTES = 64 * 1024;
const MAX_MOUNTINFO_BYTES = 16 * 1024 * 1024;
const MOUNT_ID_LINE = /^mnt_id:\s*([1-9][0-9]*)\s*$/gm;

export function linuxDescriptorMountId(descriptor) {
  if (process.platform !== 'linux'
      || !Number.isSafeInteger(descriptor)
      || descriptor < 0
      || !fs.existsSync('/proc/self/fdinfo')) {
    throw new Error('descriptor mount identity requires Linux procfs');
  }
  const bytes = fs.readFileSync(`/proc/self/fdinfo/${descriptor}`);
  if (!Buffer.isBuffer(bytes)
      || bytes.length < 1
      || bytes.length > MAX_FDINFO_BYTES) {
    throw new Error('descriptor mount identity metadata is unsafe');
  }
  const text = bytes.toString('utf8');
  const matches = [...text.matchAll(MOUNT_ID_LINE)];
  if (matches.length !== 1) {
    throw new Error('descriptor mount identity metadata is missing or ambiguous');
  }
  return matches[0][1];
}

function decodeMountInfoPath(value) {
  return value.replace(/\\([0-7]{3})/g, (_escape, octal) => (
    String.fromCharCode(Number.parseInt(octal, 8))
  ));
}

export function linuxDescriptorMountAccess(descriptor) {
  const mountId = linuxDescriptorMountId(descriptor);
  if (!fs.existsSync('/proc/self/mountinfo')) {
    throw new Error('descriptor mount access metadata requires Linux procfs');
  }
  const bytes = fs.readFileSync('/proc/self/mountinfo');
  if (!Buffer.isBuffer(bytes)
      || bytes.length < 1
      || bytes.length > MAX_MOUNTINFO_BYTES) {
    throw new Error('descriptor mount access metadata is unsafe');
  }
  const matches = bytes.toString('utf8').split('\n').filter((line) => (
    line.startsWith(`${mountId} `)
  ));
  if (matches.length !== 1) {
    throw new Error('descriptor mount access metadata is missing or ambiguous');
  }
  const separator = matches[0].indexOf(' - ');
  const fields = separator < 0
    ? []
    : matches[0].slice(0, separator).split(' ');
  if (fields.length < 6 || fields[0] !== mountId) {
    throw new Error('descriptor mount access metadata is malformed');
  }
  const accessOptions = fields[5].split(',');
  const readOnly = accessOptions.includes('ro');
  const readWrite = accessOptions.includes('rw');
  if (readOnly === readWrite) {
    throw new Error('descriptor mount access mode is missing or ambiguous');
  }
  const mountPoint = decodeMountInfoPath(fields[4]);
  if (!mountPoint.startsWith('/')) {
    throw new Error('descriptor mount point is not absolute');
  }
  return {
    mountId,
    mountPoint,
    readOnly,
  };
}
