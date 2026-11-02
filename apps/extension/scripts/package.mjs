// Packs dist/ (the production build) into release/whc-extension-<version>.zip, the
// format the Chrome Web Store and "drag and drop" installs expect. Plain ZIP
// (deflate) written with Node's zlib: no extra dependencies.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
// Never ship a test build: it has extra host access and a fixed key.
if (manifest.host_permissions || manifest.key) {
  throw new Error('dist/ contains a TEST build; run "npm run build -w @whc/extension" first');
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

const local = [];
const central = [];
let offset = 0;
for (const file of files(dist).sort()) {
  const name = Buffer.from(path.relative(dist, file).split(path.sep).join('/'));
  const data = readFileSync(file);
  const packed = deflateRawSync(data);
  const crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0x0800, 6); // UTF-8 names
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt32LE(0x21000000, 10); // 1980-01-01 00:00 (reproducible)
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(packed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  local.push(header, name, packed);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt32LE(0x21000000, 12);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(packed.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, name);
  offset += header.length + name.length + packed.length;
}
const centralBuffer = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(centralBuffer.length, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(path.join(root, 'release'), { recursive: true });
const out = path.join(root, 'release', `whc-extension-${version}.zip`);
writeFileSync(out, Buffer.concat([...local, centralBuffer, end]));
console.log(`packed ${central.length / 2} files into ${path.relative(process.cwd(), out)}`);
