// Packs extension/portal-helper into public/ledgerflow-portal-helper.zip so the app can offer it
// as a download (unzip, then chrome://extensions → Load unpacked). Runs before every build.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'extension', 'portal-helper');
const out = path.join(root, 'public', 'ledgerflow-portal-helper.zip');
const folder = 'ledgerflow-portal-helper/';

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const files = fs.readdirSync(src).filter((f) => fs.statSync(path.join(src, f)).isFile()).sort();
const locals = [];
const centrals = [];
let offset = 0;
// Fixed timestamp (1 Jan 2024) so the zip only changes when the extension does.
const dosTime = 0;
const dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1;
for (const f of files) {
  const data = fs.readFileSync(path.join(src, f));
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const name = Buffer.from(folder + f, 'utf8');
  const crc = crc32(data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(0x0800, 6); // UTF-8 names
  head.writeUInt16LE(8, 8); // deflate
  head.writeUInt16LE(dosTime, 10);
  head.writeUInt16LE(dosDate, 12);
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(packed.length, 18);
  head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(name.length, 26);
  locals.push(head, name, packed);

  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(20, 4);
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(8, 10);
  cen.writeUInt16LE(dosTime, 12);
  cen.writeUInt16LE(dosDate, 14);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(packed.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(name.length, 28);
  cen.writeUInt32LE(offset, 42);
  centrals.push(cen, name);
  offset += head.length + name.length + packed.length;
}
const central = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(central.length, 12);
end.writeUInt32LE(offset, 16);
fs.writeFileSync(out, Buffer.concat([...locals, central, end]));
console.log(`Packed ${files.length} files into ${path.relative(root, out)}`);
