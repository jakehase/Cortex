import fs from 'node:fs';

const PROC_SUPER_MAGIC = 0x9fa0n;
const INITIAL_ID_MAP = Object.freeze({
  inside: 0,
  outside: 0,
  length: 4_294_967_295,
});
const ID_MAP_FLAGS = fs.constants.O_RDONLY
  | (fs.constants.O_NOFOLLOW || 0)
  | (fs.constants.O_NONBLOCK || 0)
  | (fs.constants.O_CLOEXEC || 0);

function readKernelIdMap(target, label) {
  const descriptor = fs.openSync(target, ID_MAP_FLAGS);
  try {
    const filesystem = fs.statfsSync(
      `/proc/self/fd/${descriptor}`,
      { bigint: true },
    );
    if (filesystem.type !== PROC_SUPER_MAGIC) {
      throw new Error(`${label} is not supplied by procfs`);
    }
    const stat = fs.fstatSync(descriptor, { bigint: true });
    if (!stat.isFile()) throw new Error(`${label} is not a kernel ID map`);
    const buffer = Buffer.alloc(4097);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(
        descriptor,
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (count === 0) break;
      length += count;
    }
    if (length < 1 || length === buffer.length) {
      throw new Error(`${label} has an unsafe length`);
    }
    const text = buffer.subarray(0, length).toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(buffer.subarray(0, length))) {
      throw new Error(`${label} is not strict UTF-8`);
    }
    const rows = text.trim().split('\n').map((row) => {
      const fields = row.trim().split(/\s+/).map(Number);
      if (fields.length !== 3 || fields.some((field) => (
        !Number.isSafeInteger(field) || field < 0
      ))) {
        throw new Error(`${label} is malformed`);
      }
      return {
        inside: fields[0],
        outside: fields[1],
        length: fields[2],
      };
    });
    return rows;
  } finally {
    fs.closeSync(descriptor);
  }
}

export function initialRootAuthorityAvailable() {
  try {
    assertInitialRootAuthority();
    return true;
  } catch {
    return false;
  }
}

export function assertInitialRootAuthority({ fixtureOnly = false } = {}) {
  if (fixtureOnly === true) return true;
  if (fixtureOnly !== false) {
    throw new Error('initial root authority fixture policy is invalid');
  }
  if (process.platform !== 'linux'
      || typeof process.getuid !== 'function'
      || typeof process.geteuid !== 'function'
      || typeof process.getgid !== 'function'
      || typeof process.getegid !== 'function'
      || process.getuid() !== 0
      || process.geteuid() !== 0
      || process.getgid() !== 0
      || process.getegid() !== 0) {
    throw new Error(
      'production root authority requires real and effective UID/GID 0',
    );
  }
  const uidMap = readKernelIdMap('/proc/self/uid_map', 'root authority UID map');
  const gidMap = readKernelIdMap('/proc/self/gid_map', 'root authority GID map');
  if (uidMap.length !== 1
      || gidMap.length !== 1
      || Object.keys(INITIAL_ID_MAP).some((field) => (
        uidMap[0][field] !== INITIAL_ID_MAP[field]
        || gidMap[0][field] !== INITIAL_ID_MAP[field]
      ))) {
    throw new Error(
      'production root authority requires the initial Linux user namespace; mapped namespace root is not authority',
    );
  }
  return true;
}
