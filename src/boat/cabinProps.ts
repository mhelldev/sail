// Life below deck: things on the saloon table (a sea chart with dividers and pencil, coffee, a letter,
// lunch, a fruit bowl), bookshelves above the settees (books, a radio, a plant, a ship in a bottle), a
// clock that shows the real time and a barometer that follows the wind, a lantern and a rug. Plus a
// lifebuoy on the stern rail. Static pieces are merged per material through `Parts`.

import * as THREE from 'three';
import { CABIN, deckY, LENGTH, SETTEE, TABLE } from './layout';
import type { Parts } from './parts';

const L = 0.015; // wall lining thickness (see model.ts)
const TOP = TABLE.top;

/** Small deterministic random generator, so the boat looks the same every time. */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A nautical chart: sea, sandy islands with depth contours, soundings, a compass rose and a pencilled course. */
function drawChart(ctx: CanvasRenderingContext2D): void {
  const [w, h] = [ctx.canvas.width, ctx.canvas.height];
  const rnd = random(7);
  ctx.fillStyle = '#e4eef2';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(70,110,140,0.25)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 64) (ctx.beginPath(), ctx.moveTo(x, 0), ctx.lineTo(x, h), ctx.stroke());
  for (let y = 0; y < h; y += 64) (ctx.beginPath(), ctx.moveTo(0, y), ctx.lineTo(w, y), ctx.stroke());
  const blob = (cx: number, cy: number, r: number, grow: number) => {
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const rr = (r + grow) * (0.75 + 0.25 * Math.sin(a * 3 + cx) + 0.15 * Math.cos(a * 5 + cy));
      ctx.lineTo(cx + Math.cos(a) * rr * 1.4, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
  };
  const islands = [[120, 110, 60], [380, 80, 45], [300, 290, 70], [60, 330, 40]];
  // Depth contours (shallows lighter blue), then the land.
  for (const [grow, color] of [[50, '#cfe2ec'], [28, '#bcd8e8']] as const) {
    ctx.fillStyle = color;
    for (const [x, y, r] of islands) (blob(x, y, r, grow), ctx.fill());
  }
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(40,90,140,0.6)';
  for (const [x, y, r] of islands) (blob(x, y, r, 38), ctx.stroke());
  ctx.setLineDash([]);
  for (const [x, y, r] of islands) {
    blob(x, y, r, 0);
    ctx.fillStyle = '#efe0b0';
    ctx.fill();
    ctx.strokeStyle = '#8a7a50';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.fillStyle = '#2c5878';
  ctx.font = 'italic 11px Georgia, serif';
  for (let i = 0; i < 70; i++) ctx.fillText(String(Math.floor(2 + rnd() * 28)), rnd() * w, rnd() * h);
  // Compass rose.
  const [rx, ry, rr] = [w - 90, h - 90, 60];
  ctx.strokeStyle = '#7a2a5a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(rx, ry, rr, 0, Math.PI * 2);
  ctx.arc(rx, ry, rr - 8, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const r0 = i % 9 === 0 ? rr - 18 : rr - 8;
    ctx.beginPath();
    ctx.moveTo(rx + Math.sin(a) * r0, ry - Math.cos(a) * r0);
    ctx.lineTo(rx + Math.sin(a) * rr, ry - Math.cos(a) * rr);
    ctx.stroke();
  }
  ctx.fillStyle = '#7a2a5a';
  ctx.beginPath();
  ctx.moveTo(rx, ry - rr + 10);
  ctx.lineTo(rx + 7, ry);
  ctx.lineTo(rx, ry + 10);
  ctx.lineTo(rx - 7, ry);
  ctx.fill();
  // The course, pencilled in, with position fixes.
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  const course = [[40, 230], [200, 200], [250, 150], [440, 170]];
  ctx.beginPath();
  for (const [x, y] of course) ctx.lineTo(x, y);
  ctx.stroke();
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#333';
  course.slice(1).forEach(([x, y], i) => {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(['10:40', '12:15', '14:20'][i], x + 8, y - 8);
  });
}

function drawLetter(ctx: CanvasRenderingContext2D): void {
  const [w, h] = [ctx.canvas.width, ctx.canvas.height];
  ctx.fillStyle = '#f5eedb';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#23336b';
  ctx.font = 'italic 21px Georgia, serif';
  const lines = ['Dear skipper,', '', 'the tide turns at', 'half past four.', 'Mind the sandbanks', 'off the point, and', 'bring back fish!', '', 'Fair winds,', '   the harbour master'];
  lines.forEach((line, i) => ctx.fillText(line, 22, 44 + i * 30));
}

function drawClock(ctx: CanvasRenderingContext2D, date: Date): void {
  const s = ctx.canvas.width;
  const c = s / 2;
  ctx.fillStyle = '#f6f1e4';
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = '#222';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const r0 = i % 5 === 0 ? c * 0.78 : c * 0.86;
    ctx.lineWidth = i % 5 === 0 ? 3 : 1;
    ctx.beginPath();
    ctx.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0);
    ctx.lineTo(c + Math.sin(a) * c * 0.94, c - Math.cos(a) * c * 0.94);
    ctx.stroke();
  }
  const hand = (turn: number, len: number, width: number, color: string) => {
    const a = turn * Math.PI * 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.sin(a) * len, c - Math.cos(a) * len);
    ctx.stroke();
  };
  const [h, m, sec] = [date.getHours(), date.getMinutes(), date.getSeconds()];
  hand(((h % 12) + m / 60) / 12, c * 0.5, 6, '#222');
  hand((m + sec / 60) / 60, c * 0.75, 4, '#222');
  hand(sec / 60, c * 0.8, 1.5, '#b3261e');
}

/** Barometer: the needle falls from FAIR towards STORMY as the wind picks up. */
function drawBarometer(ctx: CanvasRenderingContext2D, windSpeed: number): void {
  const s = ctx.canvas.width;
  const c = s / 2;
  ctx.fillStyle = '#f3ead2';
  ctx.fillRect(0, 0, s, s);
  const labels = ['STORMY', 'RAIN', 'CHANGE', 'FAIR', 'DRY'];
  ctx.fillStyle = '#3a2a1a';
  ctx.font = `bold ${Math.round(s * 0.075)}px Georgia, serif`;
  ctx.textAlign = 'center';
  labels.forEach((label, i) => {
    const a = (-0.75 + (i / (labels.length - 1)) * 1.5) * Math.PI * 0.75;
    ctx.save();
    ctx.translate(c + Math.sin(a) * c * 0.62, c - Math.cos(a) * c * 0.62);
    ctx.rotate(a);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  });
  const k = THREE.MathUtils.clamp(1 - windSpeed / 18, 0, 1); // 0 = stormy, 1 = dry
  const a = (-0.75 + k * 1.5) * Math.PI * 0.75;
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(c - Math.sin(a) * c * 0.15, c + Math.cos(a) * c * 0.15);
  ctx.lineTo(c + Math.sin(a) * c * 0.8, c - Math.cos(a) * c * 0.8);
  ctx.stroke();
  ctx.fillStyle = '#b58a3c';
  ctx.beginPath();
  ctx.arc(c, c, s * 0.04, 0, Math.PI * 2);
  ctx.fill();
}

export interface CabinProps {
  /** dimly self-lit materials (the cabin "lamp"), brightened at night by the model */
  materials: THREE.MeshStandardMaterial[];
  /** ticks the clock and the barometer (cheap: small canvases, at most once a second) */
  update(dt: number, windSpeed: number): void;
}

export function addCabinProps(parent: THREE.Object3D, parts: Parts, lamp: THREE.Material): CabinProps {
  const materials: THREE.MeshStandardMaterial[] = [];
  const std = (color: number, roughness = 0.6, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const c = new THREE.Color(color);
    const m = new THREE.MeshStandardMaterial({ color, roughness, emissive: c.clone().multiplyScalar(0.18), ...extra });
    materials.push(m);
    return m;
  };
  const ceramic = std(0xf4f1ea, 0.35);
  const coffee = std(0x2e1a0e, 0.2);
  const bread = std(0xc98b4a, 0.8);
  const cheese = std(0xf2c94c, 0.7);
  const appleRed = std(0xb3261e, 0.45);
  const appleGreen = std(0x7fb03a, 0.45);
  const brass = std(0xb58a3c, 0.35, { metalness: 0.8 });
  const steel = std(0xb8bec4, 0.3, { metalness: 0.8 });
  const darkWood = std(0x5b3a22, 0.6);
  const plastic = std(0x1f2326, 0.5);
  const yellow = std(0xf2c230, 0.5);
  const rugRed = std(0x8c2f2a, 0.95);
  const cream = std(0xe9dcc0, 0.95);
  const terracotta = std(0xb5643a, 0.9);
  const leaves = std(0x3f7d3a, 0.8);
  const orange = std(0xf26b1d, 0.6);
  const white = std(0xf4f4f0, 0.6);
  const books = std(0xffffff, 0.8, { vertexColors: true });
  books.emissive.setScalar(0.12);
  const glass = new THREE.MeshStandardMaterial({ color: 0xcfe6dc, roughness: 0.05, transparent: true, opacity: 0.3, depthWrite: false });

  const add = (mat: THREE.Material, g: THREE.BufferGeometry, x: number, y: number, z: number, rotY = 0) =>
    parts.add(mat, g.rotateY(rotY).translate(x, y, z));
  const textured = (tex: THREE.Texture, geometry: THREE.BufferGeometry) => {
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.18 });
    materials.push(m);
    return new THREE.Mesh(geometry, m);
  };

  // ---- The saloon table ----
  // Sea chart, with dividers and a pencil on it.
  const chart = textured(canvasTexture(512, 384, drawChart), new THREE.PlaneGeometry(0.5, 0.375));
  chart.rotation.set(-Math.PI / 2, 0, 0.1);
  chart.position.set(-0.03, TOP + 0.002, -1.62);
  parent.add(chart);
  add(steel, new THREE.CylinderGeometry(0.003, 0.003, 0.16, 5).rotateZ(Math.PI / 2 - 0.25), 0.1, TOP + 0.01, -1.55, 0.6);
  add(steel, new THREE.CylinderGeometry(0.003, 0.003, 0.16, 5).rotateZ(Math.PI / 2 + 0.25), 0.1, TOP + 0.01, -1.55, 0.6);
  add(yellow, new THREE.CylinderGeometry(0.004, 0.004, 0.17, 6).rotateZ(Math.PI / 2), -0.12, TOP + 0.006, -1.48, 1.1);

  // Coffee: two mugs, one by the chart, one by the lunch.
  const mug = (x: number, z: number, rot: number) => {
    add(ceramic, new THREE.CylinderGeometry(0.038, 0.034, 0.095, 16, 1, true), x, TOP + 0.0475, z);
    add(ceramic, new THREE.CylinderGeometry(0.034, 0.034, 0.004, 16), x, TOP + 0.002, z);
    add(coffee, new THREE.CylinderGeometry(0.035, 0.035, 0.004, 16), x, TOP + 0.08, z);
    add(ceramic, new THREE.TorusGeometry(0.024, 0.007, 6, 12, Math.PI).rotateZ(-Math.PI / 2).translate(0.038, 0, 0), x, TOP + 0.05, z, rot);
  };
  mug(0.22, -1.12, 0.4);
  mug(0.0, -2.14, 2.2);

  // A letter on its envelope.
  add(white, new THREE.BoxGeometry(0.18, 0.003, 0.12), -0.2, TOP + 0.0015, -1.04, -0.3);
  const letter = textured(canvasTexture(256, 352, drawLetter), new THREE.PlaneGeometry(0.15, 0.206));
  letter.rotation.set(-Math.PI / 2, 0, 0.45);
  letter.position.set(-0.16, TOP + 0.005, -1.17);
  parent.add(letter);

  // Lunch: bread and cheese on a plate with a knife, and a bowl of apples.
  add(ceramic, new THREE.CylinderGeometry(0.11, 0.09, 0.014, 20), 0.19, TOP + 0.007, -2.08);
  add(bread, new THREE.CapsuleGeometry(0.035, 0.1, 4, 10).rotateZ(Math.PI / 2).scale(1, 0.8, 1), 0.17, TOP + 0.042, -2.05, 0.4);
  add(cheese, new THREE.CylinderGeometry(0.06, 0.06, 0.045, 12, 1, false, 0, 0.9), 0.24, TOP + 0.036, -2.13);
  add(steel, new THREE.BoxGeometry(0.16, 0.003, 0.014), 0.2, TOP + 0.016, -1.99, -0.2);
  const bowl = new THREE.LatheGeometry([new THREE.Vector2(0.0, 0), new THREE.Vector2(0.05, 0), new THREE.Vector2(0.085, 0.035), new THREE.Vector2(0.095, 0.06)], 20);
  add(darkWood, bowl, -0.18, TOP, -2.06);
  for (const [dx, dy, dz, red] of [[-0.03, 0.06, 0, 1], [0.03, 0.06, 0.02, 0], [0, 0.07, -0.035, 1], [0.01, 0.105, 0.0, 0]] as const) {
    add(red ? appleRed : appleGreen, new THREE.SphereGeometry(0.034, 12, 8), -0.18 + dx, TOP + dy, -2.06 + dz);
  }

  // ---- Bookshelves above the settees ----
  const rnd = random(42);
  const SPINES = [0x7a1f1f, 0x1f3a6b, 0x2e5e3a, 0xc9a227, 0x5a3d6b, 0x2b2b2b, 0xd9cbb0, 0x8a4b20];
  const shelfY = SETTEE.top + 0.58;
  const depth = 0.17;
  for (const sgn of [1, -1]) {
    const wall = sgn * (CABIN.halfWidth - L);
    const inner = wall - sgn * depth;
    const [x0, x1] = [Math.min(wall, inner), Math.max(wall, inner)];
    parts.box(darkWood, x0, x1, shelfY - 0.02, shelfY, -2.45, -0.6);
    // Fiddle rail so nothing slides off in a seaway.
    parts.box(darkWood, inner - sgn * 0.01, inner, shelfY, shelfY + 0.06, -2.45, -0.6);
    parts.box(darkWood, x0, x1, shelfY - 0.02, shelfY + 0.12, -2.45, -2.43);
    parts.box(darkWood, x0, x1, shelfY - 0.02, shelfY + 0.12, -0.62, -0.6);
    // A row of books.
    let z = -2.42;
    const end = sgn > 0 ? -1.45 : -1.95;
    const color = new THREE.Color();
    while (z < end) {
      const t = 0.025 + rnd() * 0.03;
      const hgt = 0.16 + rnd() * 0.09;
      const d = 0.12 + rnd() * 0.03;
      const g = new THREE.BoxGeometry(d, hgt, t).toNonIndexed();
      color.setHex(SPINES[Math.floor(rnd() * SPINES.length)]).convertSRGBToLinear();
      g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.attributes.position.count }, () => color.toArray()).flat(), 3));
      parts.add(books, g.translate(wall - sgn * (d / 2 + 0.01), shelfY + hgt / 2, z + t / 2));
      z += t + 0.002;
    }
    if (sgn > 0) {
      // A marine radio with its dial.
      parts.box(plastic, wall - sgn * 0.15, wall - sgn * 0.01, shelfY, shelfY + 0.1, -1.3, -1.05);
      add(brass, new THREE.CylinderGeometry(0.018, 0.018, 0.01, 12).rotateZ(Math.PI / 2), wall - sgn * 0.155, shelfY + 0.05, -1.12);
      parts.box(lamp, wall - sgn * 0.152, wall - sgn * 0.15, shelfY + 0.04, shelfY + 0.075, -1.27, -1.16);
      // A pot plant.
      add(terracotta, new THREE.CylinderGeometry(0.05, 0.038, 0.08, 12), wall - sgn * 0.08, shelfY + 0.04, -0.78);
      add(leaves, new THREE.IcosahedronGeometry(0.075, 1).scale(1, 1.2, 1), wall - sgn * 0.08, shelfY + 0.15, -0.78);
    } else {
      // A ship in a bottle on a little stand.
      const bx = wall - sgn * 0.08;
      const by = shelfY + 0.06;
      const bz = -1.5;
      parts.box(darkWood, bx - 0.04, bx + 0.04, shelfY, shelfY + 0.02, bz - 0.09, bz - 0.06);
      parts.box(darkWood, bx - 0.04, bx + 0.04, shelfY, shelfY + 0.02, bz + 0.06, bz + 0.09);
      const bottle = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.17, 4, 12).rotateX(Math.PI / 2), glass);
      bottle.position.set(bx, by, bz);
      parent.add(bottle);
      add(cream, new THREE.CylinderGeometry(0.012, 0.012, 0.03, 8).rotateX(Math.PI / 2), bx, by, bz - 0.115);
      parts.box(darkWood, bx - 0.012, bx + 0.012, by - 0.03, by - 0.012, bz - 0.06, bz + 0.06);
      add(white, new THREE.ConeGeometry(0.025, 0.05, 3), bx, by + 0.005, bz - 0.015);
      add(white, new THREE.ConeGeometry(0.02, 0.04, 3), bx, by, bz + 0.03);
      // Binoculars next to it.
      for (const dz of [-0.025, 0.025]) {
        add(plastic, new THREE.CylinderGeometry(0.022, 0.026, 0.12, 10).rotateZ(Math.PI / 2), wall - sgn * 0.08, shelfY + 0.026, -1.05 + dz);
      }
    }
  }

  // ---- Front wall: clock and barometer in brass rings ----
  const wallZ = CABIN.front + L + 0.012;
  const ring = (y: number) => add(brass, new THREE.TorusGeometry(0.09, 0.012, 8, 28), 0, y, wallZ);
  const clockTex = canvasTexture(128, 128, (ctx) => drawClock(ctx, new Date()));
  const baroTex = canvasTexture(128, 128, (ctx) => drawBarometer(ctx, 5));
  for (const [tex, y] of [[clockTex, 1.74], [baroTex, 1.44]] as const) {
    ring(y);
    const face = textured(tex, new THREE.CircleGeometry(0.088, 28));
    face.position.set(0, y, wallZ - 0.004);
    parent.add(face);
  }

  // ---- A hanging lantern over the table, and a rug at the foot of the steps ----
  const lx = 0;
  const lz = (TABLE.z0 + TABLE.z1) / 2;
  parts.rod(brass, new THREE.Vector3(lx, CABIN.roofBottom, lz), new THREE.Vector3(lx, 1.9, lz), 0.004);
  add(brass, new THREE.CylinderGeometry(0.02, 0.055, 0.04, 12), lx, 1.88, lz);
  add(lamp, new THREE.CylinderGeometry(0.04, 0.045, 0.1, 12), lx, 1.81, lz);
  add(brass, new THREE.CylinderGeometry(0.05, 0.05, 0.015, 12), lx, 1.755, lz);
  parts.box(rugRed, -0.42, 0.42, CABIN.floor, CABIN.floor + 0.006, -0.8, 0.3);
  for (const z of [-0.65, 0.15]) parts.box(cream, -0.42, 0.42, CABIN.floor, CABIN.floor + 0.007, z - 0.03, z + 0.03);

  // ---- Lifebuoy on the stern rail (outside) ----
  const sternY = deckY(1);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.TorusGeometry(0.26, 0.055, 8, 8, Math.PI / 2).rotateZ((i * Math.PI) / 2);
    add(i % 2 ? white : orange, g, -1.0, sternY + 0.38, LENGTH / 2 - 0.02, 0);
  }

  // Clock and barometer: redrawn once a second.
  let since = 0;
  return {
    materials,
    update(dt, windSpeed) {
      since += dt;
      if (since < 1) return;
      since = 0;
      drawClock((clockTex.image as HTMLCanvasElement).getContext('2d')!, new Date());
      drawBarometer((baroTex.image as HTMLCanvasElement).getContext('2d')!, windSpeed);
      clockTex.needsUpdate = true;
      baroTex.needsUpdate = true;
    },
  };
}
