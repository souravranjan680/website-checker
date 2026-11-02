// Draws the toolbar icon (a check mark on a rounded square) as PNG, without
// image libraries: raw RGBA pixels → zlib → PNG chunks.
import { crc32, deflateSync } from 'node:zlib';

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Distance from point p to the segment a-b. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function makeIcon(size) {
  const rows = [];
  const radius = size * 0.22;
  const stroke = size * 0.11;
  // Check mark from (0.27,0.52) to (0.44,0.69) to (0.75,0.33), in units of size.
  const points = [0.27, 0.52, 0.44, 0.69, 0.75, 0.33].map((v) => v * size);
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0 + RGBA
    for (let x = 0; x < size; x += 1) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      // rounded square (anti-aliased edge)
      const qx = Math.max(Math.abs(cx - size / 2) - (size / 2 - radius), 0);
      const qy = Math.max(Math.abs(cy - size / 2) - (size / 2 - radius), 0);
      const outside = Math.hypot(qx, qy) - radius;
      const alpha = Math.max(0, Math.min(1, 0.5 - outside));
      const d = Math.min(
        segmentDistance(cx, cy, points[0], points[1], points[2], points[3]),
        segmentDistance(cx, cy, points[2], points[3], points[4], points[5]),
      );
      const mark = Math.max(0, Math.min(1, stroke / 2 + 0.5 - d));
      // background #1d4ed8, check mark white
      const r = Math.round(29 + (255 - 29) * mark);
      const g = Math.round(78 + (255 - 78) * mark);
      const b = Math.round(216 + (255 - 216) * mark);
      row.writeUInt8(r, 1 + x * 4);
      row.writeUInt8(g, 2 + x * 4);
      row.writeUInt8(b, 3 + x * 4);
      row.writeUInt8(Math.round(alpha * 255), 4 + x * 4);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(6, 9); // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
