// Generates cover.png (800x534) for gladys-eheim-digital: plain Node, no
// dependency. An aquarium with fish, plants and bubbles, a thermometer and
// local network waves on a deep blue-to-green gradient (no brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = (x / W + y / H) / 2;
    set(x, y, [10 + 20 * t, 50 + 90 * t, 110 + 30 * t]);
  }
}
const white = [255, 255, 255];
const red = [235, 80, 60];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const ellipse = (cx, cy, rx, ry, color, alpha = 1) => {
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y += 1) {
    for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x += 1) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      const a = Math.max(0, Math.min(1, (1 - d) * Math.min(rx, ry) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
// An arc of a ring, between two angles (radians, 0 = right, clockwise on screen).
const arc = (cx, cy, r, width, from, to, color) => {
  for (let y = Math.floor(cy - r - width); y <= cy + r + width; y += 1) {
    for (let x = Math.floor(cx - r - width); x <= cx + r + width; x += 1) {
      const angle = Math.atan2(y - cy, x - cx);
      if (angle < from || angle > to) continue;
      const a = Math.max(
        0,
        Math.min(1, width / 2 - Math.abs(Math.hypot(x - cx, y - cy) - r) + 0.5),
      );
      if (a > 0) set(x, y, color, a);
    }
  }
};
// Rounded rectangle, anti-aliased corners.
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a);
    }
  }
};

// The tank: a frame, the water, the sand.
box(90, 110, 620, 460, 18, [225, 235, 240]);
box(104, 124, 606, 446, 10, [40, 140, 190]);
box(104, 140, 606, 160, 0, [70, 170, 215], 0.6);
box(104, 405, 606, 446, 10, [220, 195, 140]);

// Plants.
const green = [60, 170, 90];
for (const [x, h, sway] of [
  [150, 210, 18],
  [175, 160, -14],
  [540, 230, -20],
  [565, 170, 16],
]) {
  for (let i = 0; i < 6; i += 1) {
    const y0 = 410 - (i * h) / 6;
    const y1 = 410 - ((i + 1) * h) / 6;
    const dx0 = Math.sin(i / 2) * sway;
    const dx1 = Math.sin((i + 1) / 2) * sway;
    line(x + dx0, y0, x + dx1, y1, 10, green);
  }
}

// Fish: a body and a tail.
const fish = (cx, cy, size, color, flip = 1) => {
  ellipse(cx, cy, size, size * 0.55, color);
  for (let i = 0; i < size * 0.7; i += 1) {
    const x = cx - flip * (size + i * 0.9);
    line(x, cy - i * 0.6, x, cy + i * 0.6, 2, color);
  }
  disc(cx + flip * size * 0.5, cy - size * 0.12, size * 0.12, white);
  disc(cx + flip * size * 0.53, cy - size * 0.12, size * 0.06, [20, 30, 40]);
};
fish(300, 250, 42, [250, 150, 50]);
fish(430, 320, 32, [250, 210, 70], -1);
fish(250, 360, 24, [240, 110, 120]);

// Bubbles from the filter outlet.
for (const [x, y, r] of [
  [470, 210, 9],
  [490, 180, 6],
  [480, 150, 8],
  [500, 230, 5],
]) {
  arc(x, y, r, 3, -Math.PI, Math.PI, white);
}

// The thermometer.
box(675, 150, 705, 380, 15, white);
box(683, 230, 697, 380, 7, red);
disc(690, 400, 28, red);
for (const y of [190, 240, 290, 340]) {
  line(712, y, 730, y, 5, white);
}

// Local network waves (no cloud).
for (const r of [18, 36, 54]) {
  arc(110, 60, r, 8, -2.4, -0.74, white);
}
disc(110, 60, 6, white);

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
