/**
 * Minimal ZIP writer, built on Node's own `zlib`.
 *
 * Why not a dependency: DropForge ships its releases from this repository, and the
 * fewer tools a release needs, the fewer ways it can silently differ between a
 * developer's machine and the release pipeline. The compression itself is `zlib`
 * (deflate), the CRC is the standard table-driven CRC-32 — no algorithm is invented
 * here, only the container format is written.
 *
 * Scope: the archives this project produces (a few dozen MB at most, standard
 * filenames, no Zip64, no encryption, no symlinks). Anything outside that scope
 * throws instead of producing a subtly broken archive.
 */
import { deflateRawSync } from 'node:zlib';

const MAX_UINT32 = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** CRC-32 of a byte array, as the ZIP format defines it. */
export function crc32(data) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const toBytes = (data) => (typeof data === 'string' ? new TextEncoder().encode(data) : data);

/** MS-DOS date and time, the only timestamps a classic ZIP entry carries. */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * Builds a ZIP archive.
 *
 * @param {Array<{ path: string; data: Uint8Array | string; date?: Date }>} entries
 * @returns {Uint8Array}
 */
export function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (name.length === 0) throw new Error('a zip entry needs a path');
    const nameBytes = new TextEncoder().encode(name);
    const raw = toBytes(entry.data);
    const date = entry.date ?? new Date();
    const { time, day } = dosDateTime(date);

    const deflated = deflateRawSync(raw, { level: 9 });
    // Storing beats deflating when deflate grows the data (already-compressed files).
    const stored = deflated.length >= raw.length;
    const body = stored ? raw : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(raw);
    if (raw.length > MAX_UINT32 || offset > MAX_UINT32) {
      throw new Error(`the archive is too large for a classic zip (${name})`);
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 filenames
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    localParts.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header
    central.writeUInt16LE(0x031e, 4); // made by: unix, 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attributes: -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // no archive comment

  return new Uint8Array(Buffer.concat([...localParts, ...centralParts, end]));
}
